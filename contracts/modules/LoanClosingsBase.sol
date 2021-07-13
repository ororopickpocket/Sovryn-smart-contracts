/**
 * Copyright 2017-2020, bZeroX, LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0.
 */

pragma solidity 0.5.17;
pragma experimental ABIEncoderV2;

import "../core/State.sol";
import "../events/LoanClosingsEvents.sol";
import "../mixins/VaultController.sol";
import "../mixins/InterestUser.sol";
import "../mixins/LiquidationHelper.sol";
import "../swaps/SwapsUser.sol";
import "../interfaces/ILoanPool.sol";
import "../mixins/RewardHelper.sol";

/**
 * @title LoanClosingsBase contract.
 * @notice Ways to close a loan: liquidation, rollover. Margin trade
 *   positions are always closed with a swap.
 *
 * Loans are liquidated if the position goes below margin maintenance.
 * */
contract LoanClosingsBase is LoanClosingsEvents, VaultController, InterestUser, SwapsUser, LiquidationHelper, RewardHelper {
	uint256 internal constant MONTH = 365 days / 12;
	//0.00001 BTC, would be nicer in State.sol, but would require a redeploy of the complete protocol, so adding it here instead
	//because it's not shared state anyway and only used by this contract
	uint256 public constant paySwapExcessToBorrowerThreshold = 10000000000000;

	enum CloseTypes { Deposit, Swap, Liquidation }

	constructor() public {}

	function() external {
		revert("fallback not allowed");
	}

	function initialize(address target) external onlyOwner {
		_setTarget(this.liquidate.selector, target);
		_setTarget(this.rollover.selector, target);
	}

	/**
	 * @notice Liquidate an unhealty loan.
	 *
	 * @dev Public wrapper for _liquidate internal function.
	 *
	 * The caller needs to approve the closeAmount prior to calling. Will
	 * not liquidate more than is needed to restore the desired margin
	 * (maintenance +5%).
	 *
	 * Whenever the current margin of a loan falls below maintenance margin,
	 * it needs to be liquidated. Anybody can initiate a liquidation and buy
	 * the collateral tokens at a discounted rate (5%).
	 *
	 * @param loanId The ID of the loan to liquidate.
	 *   loanId is the ID of the loan, which is created on loan opening.
	 *   It can be obtained either by parsing the Trade event or by reading
	 *   the open loans from the contract by calling getActiveLoans or getUserLoans.
	 * @param receiver The receiver of the seized amount.
	 * @param closeAmount The amount to close in loanTokens.
	 *
	 * @return loanCloseAmount The amount of the collateral token of the loan.
	 * @return seizedAmount The seized amount in the collateral token.
	 * @return seizedToken The loan token address.
	 * */
	function liquidate(
		bytes32 loanId,
		address receiver,
		uint256 closeAmount // denominated in loanToken
	)
		external
		payable
		nonReentrant
		returns (
			uint256 loanCloseAmount,
			uint256 seizedAmount,
			address seizedToken
		)
	{
		return _liquidate(loanId, receiver, closeAmount);
	}

	/**
	 * @notice Roll over a loan.
	 *
	 * @dev Public wrapper for _rollover internal function.
	 *
	 * Each loan has a duration. In case of a margin trade it is set to 28
	 * days, in case of borrowing, it can be set by the user. On loan
	 * openning, the user pays the interest for this duration in advance.
	 * If closing early, he gets the excess refunded. If it is not closed
	 * before the end date, it needs to be rolled over. On rollover the
	 * interest is paid for the next period. In case of margin trading
	 * it's 28 days, in case of borrowing it's a month.
	 *
	 * The function rollover on the protocol contract extends the loan
	 * duration by the maximum term (28 days for margin trades at the moment
	 * of writing), pays the interest to the lender and refunds the caller
	 * for the gas cost by sending 2 * the gas cost using the fast gas price
	 * as base for the calculation.
	 *
	 * @param loanId The ID of the loan to roll over.
	 * // param calldata The payload for the call. These loan DataBytes are additional loan data (not in use for token swaps).
	 * */
	function rollover(
		bytes32 loanId,
		bytes calldata // for future use /*loanDataBytes*/
	) external nonReentrant {
		// restrict to EOAs to prevent griefing attacks, during interest rate recalculation
		require(msg.sender == tx.origin, "only EOAs can call");

		return
			_rollover(
				loanId,
				"" // loanDataBytes
			);
	}

	/**
	 * @notice Internal function for liquidating an unhealthy loan.
	 *
	 * The caller needs to approve the closeAmount prior to calling. Will
	 * not liquidate more than is needed to restore the desired margin
	 * (maintenance +5%).
	 *
	 * Whenever the current margin of a loan falls below maintenance margin,
	 * it needs to be liquidated. Anybody can initiate a liquidation and buy
	 * the collateral tokens at a discounted rate (5%).
	 *
	 * @param loanId The ID of the loan to liquidate.
	 * @param receiver The receiver of the seized amount.
	 * @param closeAmount The amount to close in loanTokens.
	 *
	 * @return loanCloseAmount The amount of the collateral token of the loan.
	 * @return seizedAmount The seized amount in the collateral token.
	 * @return seizedToken The loan token address.
	 * */
	function _liquidate(
		bytes32 loanId,
		address receiver,
		uint256 closeAmount
	)
		internal
		returns (
			uint256 loanCloseAmount,
			uint256 seizedAmount,
			address seizedToken
		)
	{
		Loan storage loanLocal = loans[loanId];
		LoanParams storage loanParamsLocal = loanParams[loanLocal.loanParamsId];

		require(loanLocal.active, "loan is closed");
		require(loanParamsLocal.id != 0, "loanParams not exists");

		(uint256 currentMargin, uint256 collateralToLoanRate) =
			IPriceFeeds(priceFeeds).getCurrentMargin(
				loanParamsLocal.loanToken,
				loanParamsLocal.collateralToken,
				loanLocal.principal,
				loanLocal.collateral
			);
		require(currentMargin <= loanParamsLocal.maintenanceMargin, "healthy position");

		loanCloseAmount = closeAmount;

		//amounts to restore the desired margin (maintencance + 5%)
		(uint256 maxLiquidatable, uint256 maxSeizable, ) =
			_getLiquidationAmounts(
				loanLocal.principal,
				loanLocal.collateral,
				currentMargin,
				loanParamsLocal.maintenanceMargin,
				collateralToLoanRate
			);

		if (loanCloseAmount < maxLiquidatable) {
			seizedAmount = maxSeizable.mul(loanCloseAmount).div(maxLiquidatable);
		} else if (loanCloseAmount > maxLiquidatable) {
			// adjust down the close amount to the max
			loanCloseAmount = maxLiquidatable;
			seizedAmount = maxSeizable;
		} else {
			seizedAmount = maxSeizable;
		}

		require(loanCloseAmount != 0, "nothing to liquidate");

		// liquidator deposits the principal being closed
		_returnPrincipalWithDeposit(loanParamsLocal.loanToken, address(this), loanCloseAmount);

		// a portion of the principal is repaid to the lender out of interest refunded
		uint256 loanCloseAmountLessInterest = _settleInterestToPrincipal(loanLocal, loanParamsLocal, loanCloseAmount, loanLocal.borrower);

		if (loanCloseAmount > loanCloseAmountLessInterest) {
			// full interest refund goes to the borrower
			_withdrawAsset(loanParamsLocal.loanToken, loanLocal.borrower, loanCloseAmount - loanCloseAmountLessInterest);
		}

		if (loanCloseAmountLessInterest != 0) {
			// The lender always gets back an ERC20 (even wrbtc), so we call withdraw directly rather than
			// use the _withdrawAsset helper function
			vaultWithdraw(loanParamsLocal.loanToken, loanLocal.lender, loanCloseAmountLessInterest);
		}

		seizedToken = loanParamsLocal.collateralToken;

		if (seizedAmount != 0) {
			loanLocal.collateral = loanLocal.collateral.sub(seizedAmount);

			_withdrawAsset(seizedToken, receiver, seizedAmount);
		}

		_closeLoan(loanLocal, loanCloseAmount);

		_emitClosingEvents(
			loanParamsLocal,
			loanLocal,
			loanCloseAmount,
			seizedAmount,
			collateralToLoanRate,
			currentMargin,
			CloseTypes.Liquidation
		);
	}

	/**
	 * @notice Internal function for roll over a loan.
	 *
	 * Each loan has a duration. In case of a margin trade it is set to 28
	 * days, in case of borrowing, it can be set by the user. On loan
	 * openning, the user pays the interest for this duration in advance.
	 * If closing early, he gets the excess refunded. If it is not closed
	 * before the end date, it needs to be rolled over. On rollover the
	 * interest is paid for the next period. In case of margin trading
	 * it's 28 days, in case of borrowing it's a month.
	 *
	 * @param loanId The ID of the loan to roll over.
	 * @param loanDataBytes The payload for the call. These loan DataBytes are
	 *   additional loan data (not in use for token swaps).
	 * */
	function _rollover(bytes32 loanId, bytes memory loanDataBytes) internal {
		Loan storage loanLocal = loans[loanId];
		LoanParams storage loanParamsLocal = loanParams[loanLocal.loanParamsId];

		require(loanLocal.active, "loan is closed");
		require(loanParamsLocal.id != 0, "loanParams not exists");
		require(block.timestamp > loanLocal.endTimestamp.sub(3600), "healthy position");
		require(loanPoolToUnderlying[loanLocal.lender] != address(0), "invalid lender");

		// pay outstanding interest to lender
		_payInterest(loanLocal.lender, loanParamsLocal.loanToken);

		LoanInterest storage loanInterestLocal = loanInterest[loanLocal.id];
		LenderInterest storage lenderInterestLocal = lenderInterest[loanLocal.lender][loanParamsLocal.loanToken];

		_settleFeeRewardForInterestExpense(
			loanInterestLocal,
			loanLocal.id,
			loanParamsLocal.loanToken, /// fee token
			loanParamsLocal.collateralToken, /// pairToken (used to check if there is any special rebates or not) -- to pay fee reward
			loanLocal.borrower,
			block.timestamp
		);

		// Handle back interest: calculates interest owned since the loan endtime passed but the loan remained open
		uint256 backInterestTime;
		uint256 backInterestOwed;
		if (block.timestamp > loanLocal.endTimestamp) {
			backInterestTime = block.timestamp.sub(loanLocal.endTimestamp);
			backInterestOwed = backInterestTime.mul(loanInterestLocal.owedPerDay);
			backInterestOwed = backInterestOwed.div(1 days);
		}

		//note: to avoid code duplication, it would be nicer to store loanParamsLocal.maxLoanTerm in a local variable
		//however, we've got stack too deep issues if we do so.
		if (loanParamsLocal.maxLoanTerm != 0) {
			// fixed-term loan, so need to query iToken for latest variable rate
			uint256 owedPerDay = loanLocal.principal.mul(ILoanPool(loanLocal.lender).borrowInterestRate()).div(365 * 10**20);

			lenderInterestLocal.owedPerDay = lenderInterestLocal.owedPerDay.add(owedPerDay);
			lenderInterestLocal.owedPerDay = lenderInterestLocal.owedPerDay.sub(loanInterestLocal.owedPerDay);

			loanInterestLocal.owedPerDay = owedPerDay;

			//if the loan has been open for longer than an additional period, add at least 1 additional day
			if (backInterestTime >= loanParamsLocal.maxLoanTerm) {
				loanLocal.endTimestamp = loanLocal.endTimestamp.add(backInterestTime).add(1 days);
			}
			//extend by the max loan term
			else {
				loanLocal.endTimestamp = loanLocal.endTimestamp.add(loanParamsLocal.maxLoanTerm);
			}
		} else {
			// loanInterestLocal.owedPerDay doesn't change
			if (backInterestTime >= MONTH) {
				loanLocal.endTimestamp = loanLocal.endTimestamp.add(backInterestTime).add(1 days);
			} else {
				loanLocal.endTimestamp = loanLocal.endTimestamp.add(MONTH);
			}
		}

		uint256 interestAmountRequired = loanLocal.endTimestamp.sub(block.timestamp);
		interestAmountRequired = interestAmountRequired.mul(loanInterestLocal.owedPerDay);
		interestAmountRequired = interestAmountRequired.div(1 days);

		loanInterestLocal.depositTotal = loanInterestLocal.depositTotal.add(interestAmountRequired);

		lenderInterestLocal.owedTotal = lenderInterestLocal.owedTotal.add(interestAmountRequired);

		// add backInterestOwed
		interestAmountRequired = interestAmountRequired.add(backInterestOwed);

		// collect interest (needs to be converted from the collateral)
		(uint256 destTokenAmountReceived, uint256 sourceTokenAmountUsed, ) =
			_doCollateralSwap(
				loanLocal,
				loanParamsLocal,
				0, //min swap 0 -> swap connector estimates the amount of source tokens to use
				interestAmountRequired, //required destination tokens
				true, // returnTokenIsCollateral
				loanDataBytes
			);

		//received more tokens than needed to pay the interest
		if (destTokenAmountReceived > interestAmountRequired) {
			// swap rest back to collateral, if the amount is big enough to cover gas cost
			if (worthTheTransfer(loanParamsLocal.loanToken, destTokenAmountReceived - interestAmountRequired)) {
				(destTokenAmountReceived, , ) = _swapBackExcess(
					loanLocal,
					loanParamsLocal,
					destTokenAmountReceived - interestAmountRequired, //amount to be swapped
					loanDataBytes
				);
				sourceTokenAmountUsed = sourceTokenAmountUsed.sub(destTokenAmountReceived);
			}
			//else give it to the protocol as a lending fee
			else {
				_payLendingFee(loanLocal.borrower, loanParamsLocal.loanToken, destTokenAmountReceived - interestAmountRequired);
			}
		}

		//subtract the interest from the collateral
		loanLocal.collateral = loanLocal.collateral.sub(sourceTokenAmountUsed);

		if (backInterestOwed != 0) {
			// pay out backInterestOwed

			_payInterestTransfer(loanLocal.lender, loanParamsLocal.loanToken, backInterestOwed);
		}

		uint256 rolloverReward = _getRolloverReward(loanParamsLocal.collateralToken, loanParamsLocal.loanToken, loanLocal.principal);

		if (rolloverReward != 0) {
			// pay out reward to caller
			loanLocal.collateral = loanLocal.collateral.sub(rolloverReward);

			_withdrawAsset(loanParamsLocal.collateralToken, msg.sender, rolloverReward);
		}

		(uint256 currentMargin, ) =
			IPriceFeeds(priceFeeds).getCurrentMargin(
				loanParamsLocal.loanToken,
				loanParamsLocal.collateralToken,
				loanLocal.principal,
				loanLocal.collateral
			);
		require(
			currentMargin > 3 ether, // ensure there's more than 3% margin remaining
			"unhealthy position"
		);
	}

	/**
	 * @dev computes the interest which needs to be refunded to the borrower based on the amount he's closing and either
	 * subtracts it from the amount which still needs to be paid back (in case outstanding amount > interest) or withdraws the
	 * excess to the borrower (in case interest > outstanding).
	 * @param loanLocal the loan
	 * @param loanParamsLocal the loan params
	 * @param loanCloseAmount the amount to be closed (base for the computation)
	 * @param receiver the address of the receiver (usually the borrower)
	 * */
	function _settleInterestToPrincipal(
		Loan memory loanLocal,
		LoanParams memory loanParamsLocal,
		uint256 loanCloseAmount,
		address receiver
	) internal returns (uint256) {
		uint256 loanCloseAmountLessInterest = loanCloseAmount;

		//compute the interest which neeeds to be refunded to the borrower (because full interest is paid on loan )
		uint256 interestRefundToBorrower = _settleInterest(loanParamsLocal, loanLocal, loanCloseAmountLessInterest);

		uint256 interestAppliedToPrincipal;
		//if the outstanding loan is bigger than the interest to be refunded, reduce the amount to be paid back / closed by the interest
		if (loanCloseAmountLessInterest >= interestRefundToBorrower) {
			// apply all of borrower interest refund torwards principal
			interestAppliedToPrincipal = interestRefundToBorrower;

			// principal needed is reduced by this amount
			loanCloseAmountLessInterest -= interestRefundToBorrower;

			// no interest refund remaining
			interestRefundToBorrower = 0;
		} else {
			//if the interest refund is bigger than the outstanding loan, the user needs to get back the interest
			// principal fully covered by excess interest
			interestAppliedToPrincipal = loanCloseAmountLessInterest;

			// amount refunded is reduced by this amount
			interestRefundToBorrower -= loanCloseAmountLessInterest;

			// principal fully covered by excess interest
			loanCloseAmountLessInterest = 0;

			if (interestRefundToBorrower != 0) {
				// refund overage
				_withdrawAsset(loanParamsLocal.loanToken, receiver, interestRefundToBorrower);
			}
		}

		//pay the interest to the lender
		//note: this is a waste of gas, because the loanCloseAmountLessInterest is withdrawn to the lender, too. It could be done at once.
		if (interestAppliedToPrincipal != 0) {
			// The lender always gets back an ERC20 (even wrbtc), so we call withdraw directly rather than
			// use the _withdrawAsset helper function
			vaultWithdraw(loanParamsLocal.loanToken, loanLocal.lender, interestAppliedToPrincipal);
		}

		return loanCloseAmountLessInterest;
	}

	// The receiver always gets back an ERC20 (even wrbtc)
	function _returnPrincipalWithDeposit(
		address loanToken,
		address receiver,
		uint256 principalNeeded
	) internal {
		if (principalNeeded != 0) {
			if (msg.value == 0) {
				vaultTransfer(loanToken, msg.sender, receiver, principalNeeded);
			} else {
				require(loanToken == address(wrbtcToken), "wrong asset sent");
				require(msg.value >= principalNeeded, "not enough ether");
				wrbtcToken.deposit.value(principalNeeded)();
				if (receiver != address(this)) {
					vaultTransfer(loanToken, address(this), receiver, principalNeeded);
				}
				if (msg.value > principalNeeded) {
					// refund overage
					Address.sendValue(msg.sender, msg.value - principalNeeded);
				}
			}
		} else {
			require(msg.value == 0, "wrong asset sent");
		}
	}

	/**
	 * @dev checks if the amount of the asset to be transfered is worth the transfer fee
	 * @param asset the asset to be transfered
	 * @param amount the amount to be transfered
	 * @return True if the amount is bigger than the threshold
	 * */
	function worthTheTransfer(address asset, uint256 amount) internal returns (bool) {
		(uint256 rbtcRate, uint256 rbtcPrecision) = IPriceFeeds(priceFeeds).queryRate(asset, address(wrbtcToken));
		uint256 amountInRbtc = amount.mul(rbtcRate).div(rbtcPrecision);
		emit swapExcess(amountInRbtc > paySwapExcessToBorrowerThreshold, amount, amountInRbtc, paySwapExcessToBorrowerThreshold);
		return amountInRbtc > paySwapExcessToBorrowerThreshold;
	}

	/**
	 * swaps collateral tokens for loan tokens
	 * @param loanLocal the loan object
	 * @param loanParamsLocal the loan parameters
	 * @param swapAmount the amount to be swapped
	 * @param principalNeeded the required destination token amount
	 * @param returnTokenIsCollateral if true -> required destination token amount will be passed on, else not
	 *          note: quite dirty. should be refactored.
	 * @param loanDataBytes additional loan data (not in use for token swaps)
	 * */
	function _doCollateralSwap(
		Loan memory loanLocal,
		LoanParams memory loanParamsLocal,
		uint256 swapAmount,
		uint256 principalNeeded,
		bool returnTokenIsCollateral,
		bytes memory loanDataBytes
	)
		internal
		returns (
			uint256 destTokenAmountReceived,
			uint256 sourceTokenAmountUsed,
			uint256 collateralToLoanSwapRate
		)
	{
		(destTokenAmountReceived, sourceTokenAmountUsed, collateralToLoanSwapRate) = _loanSwap(
			loanLocal.id,
			loanParamsLocal.collateralToken,
			loanParamsLocal.loanToken,
			loanLocal.borrower,
			swapAmount, // minSourceTokenAmount
			loanLocal.collateral, // maxSourceTokenAmount
			returnTokenIsCollateral
				? principalNeeded // requiredDestTokenAmount
				: 0,
			false, // bypassFee
			loanDataBytes
		);
		require(destTokenAmountReceived >= principalNeeded, "insufficient dest amount");
		require(sourceTokenAmountUsed <= loanLocal.collateral, "excessive source amount");
	}

	/**
	 * @notice Swap back excessive loan tokens to collateral tokens.
	 *
	 * @param loanLocal The loan object.
	 * @param loanParamsLocal The loan parameters.
	 * @param swapAmount The amount to be swapped.
	 * @param loanDataBytes Additional loan data (not in use for token swaps).
	 *
	 * @return destTokenAmountReceived The amount of destiny tokens received.
	 * @return sourceTokenAmountUsed The amount of source tokens used.
	 * @return collateralToLoanSwapRate The swap rate of collateral.
	 * */
	function _swapBackExcess(
		Loan memory loanLocal,
		LoanParams memory loanParamsLocal,
		uint256 swapAmount,
		bytes memory loanDataBytes
	)
		internal
		returns (
			uint256 destTokenAmountReceived,
			uint256 sourceTokenAmountUsed,
			uint256 collateralToLoanSwapRate
		)
	{
		(destTokenAmountReceived, sourceTokenAmountUsed, collateralToLoanSwapRate) = _loanSwap(
			loanLocal.id,
			loanParamsLocal.loanToken,
			loanParamsLocal.collateralToken,
			loanLocal.borrower,
			swapAmount, // minSourceTokenAmount
			swapAmount, // maxSourceTokenAmount
			0, // requiredDestTokenAmount
			false, // bypassFee
			loanDataBytes
		);
		require(sourceTokenAmountUsed <= swapAmount, "excessive source amount");
	}

	/**
	 * @notice Withdraw asset to receiver.
	 *
	 * @param assetToken The loan token.
	 * @param receiver The address of the receiver.
	 * @param assetAmount The loan token amount.
	 * */
	function _withdrawAsset(
		address assetToken,
		address receiver,
		uint256 assetAmount
	) internal {
		if (assetAmount != 0) {
			if (assetToken == address(wrbtcToken)) {
				vaultEtherWithdraw(receiver, assetAmount);
			} else {
				vaultWithdraw(assetToken, receiver, assetAmount);
			}
		}
	}

	/**
	 * @notice Internal function to close a loan.
	 *
	 * @param loanLocal The loan object.
	 * @param loanCloseAmount The amount to close: principal or lower.
	 *
	 * */
	function _closeLoan(Loan storage loanLocal, uint256 loanCloseAmount) internal {
		require(loanCloseAmount != 0, "nothing to close");

		if (loanCloseAmount == loanLocal.principal) {
			loanLocal.principal = 0;
			loanLocal.active = false;
			loanLocal.endTimestamp = block.timestamp;
			loanLocal.pendingTradesId = 0;
			activeLoansSet.removeBytes32(loanLocal.id);
			lenderLoanSets[loanLocal.lender].removeBytes32(loanLocal.id);
			borrowerLoanSets[loanLocal.borrower].removeBytes32(loanLocal.id);
		} else {
			loanLocal.principal = loanLocal.principal.sub(loanCloseAmount);
		}
	}

	function _settleInterest(
		LoanParams memory loanParamsLocal,
		Loan memory loanLocal,
		uint256 closePrincipal
	) internal returns (uint256) {
		// pay outstanding interest to lender
		_payInterest(loanLocal.lender, loanParamsLocal.loanToken);

		LoanInterest storage loanInterestLocal = loanInterest[loanLocal.id];
		LenderInterest storage lenderInterestLocal = lenderInterest[loanLocal.lender][loanParamsLocal.loanToken];

		uint256 interestTime = block.timestamp;
		if (interestTime > loanLocal.endTimestamp) {
			interestTime = loanLocal.endTimestamp;
		}

		_settleFeeRewardForInterestExpense(
			loanInterestLocal,
			loanLocal.id,
			loanParamsLocal.loanToken, /// fee token
			loanParamsLocal.collateralToken, /// pairToken (used to check if there is any special rebates or not) -- to pay fee reward
			loanLocal.borrower,
			interestTime
		);

		uint256 owedPerDayRefund;
		if (closePrincipal < loanLocal.principal) {
			owedPerDayRefund = loanInterestLocal.owedPerDay.mul(closePrincipal).div(loanLocal.principal);
		} else {
			owedPerDayRefund = loanInterestLocal.owedPerDay;
		}

		// update stored owedPerDay
		loanInterestLocal.owedPerDay = loanInterestLocal.owedPerDay.sub(owedPerDayRefund);
		lenderInterestLocal.owedPerDay = lenderInterestLocal.owedPerDay.sub(owedPerDayRefund);

		// update borrower interest
		uint256 interestRefundToBorrower = loanLocal.endTimestamp.sub(interestTime);
		interestRefundToBorrower = interestRefundToBorrower.mul(owedPerDayRefund);
		interestRefundToBorrower = interestRefundToBorrower.div(1 days);

		if (closePrincipal < loanLocal.principal) {
			loanInterestLocal.depositTotal = loanInterestLocal.depositTotal.sub(interestRefundToBorrower);
		} else {
			loanInterestLocal.depositTotal = 0;
		}

		// update remaining lender interest values
		lenderInterestLocal.principalTotal = lenderInterestLocal.principalTotal.sub(closePrincipal);

		uint256 owedTotal = lenderInterestLocal.owedTotal;
		lenderInterestLocal.owedTotal = owedTotal > interestRefundToBorrower ? owedTotal - interestRefundToBorrower : 0;

		return interestRefundToBorrower;
	}

	function _emitClosingEvents(
		LoanParams memory loanParamsLocal,
		Loan memory loanLocal,
		uint256 loanCloseAmount,
		uint256 collateralCloseAmount,
		uint256 collateralToLoanRate,
		uint256 currentMargin,
		CloseTypes closeType
	) internal {
		if (closeType == CloseTypes.Liquidation)
			emit Liquidate(
				loanLocal.borrower, // user (borrower)
				msg.sender, // liquidator
				loanLocal.id, // loanId
				loanLocal.lender, // lender
				loanParamsLocal.loanToken, // loanToken
				loanParamsLocal.collateralToken, // collateralToken
				loanCloseAmount, // loanCloseAmount
				collateralCloseAmount, // collateralCloseAmount
				collateralToLoanRate, // collateralToLoanRate
				currentMargin // currentMargin
			);
	}
}
