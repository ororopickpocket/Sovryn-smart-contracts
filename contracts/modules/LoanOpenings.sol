/**
 * Copyright 2017-2020, bZeroX, LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0.
 */

pragma solidity 0.5.17;
pragma experimental ABIEncoderV2;

import "../core/State.sol";
import "../events/LoanOpeningsEvents.sol";
import "../mixins/VaultController.sol";
import "../mixins/InterestUser.sol";
import "../swaps/SwapsUser.sol";

/**
 * @title Loan Openings contract.
 *
 * @notice This contract code comes from bZx. bZx is a protocol for tokenized
 * margin trading and lending https://bzx.network similar to the dYdX protocol.
 *
 * This contract contains functions to borrow and trade.
 * */
contract LoanOpenings is LoanOpeningsEvents, VaultController, InterestUser, SwapsUser {
	constructor() public {}

	/**
	 * @notice Fallback function is to react to receiving value (rBTC).
	 * */
	function() external {
		revert("fallback not allowed");
	}

	/**
	 * @notice Set function selectors on target contract.
	 *
	 * @param target The address of the target contract.
	 * */
	function initialize(address target) external onlyOwner {
		_setTarget(this.borrowOrTradeFromPool.selector, target);
		_setTarget(this.setDelegatedManager.selector, target);
		_setTarget(this.getEstimatedMarginExposure.selector, target);
		_setTarget(this.getRequiredCollateral.selector, target);
		_setTarget(this.getBorrowAmount.selector, target);
	}

	/**
	 * @notice Borrow or trade from pool.
	 *
	 * @dev Note: Only callable by loan pools (iTokens).
	 * Wrapper to _borrowOrTrade internal function.
	 *
	 * @param loanParamsId The ID of the loan parameters.
	 * @param loanId The ID of the loan. If 0, start a new loan.
	 * @param isTorqueLoan Whether the loan is a Torque loan.
	 * @param initialMargin The initial amount of margin.
	 * @param sentAddresses The addresses to send tokens: lender, borrower,
	 *   receiver and manager:
	 *     lender: must match loan if loanId provided.
	 *     borrower: must match loan if loanId provided.
	 *     receiver: receiver of funds (address(0) assumes borrower address).
	 *     manager: delegated manager of loan unless address(0).
	 * @param sentValues The values to send:
	 *     newRate: New loan interest rate.
	 *     newPrincipal: New loan size (borrowAmount + any borrowed interest).
	 *     torqueInterest: New amount of interest to escrow for Torque loan (determines initial loan length).
	 *     loanTokenReceived: Total loanToken deposit (amount not sent to borrower in the case of Torque loans).
	 *     collateralTokenReceived: Total collateralToken deposit.
	 * @param loanDataBytes The payload for the call. These loan DataBytes are
	 *   additional loan data (not in use for token swaps).
	 *
	 * @return newPrincipal The new loan size.
	 * @return newCollateral The new collateral amount.
	 * */
	function borrowOrTradeFromPool(
		bytes32 loanParamsId,
		bytes32 loanId,
		bool isTorqueLoan,
		uint256 initialMargin,
		address[4] calldata sentAddresses,
		uint256[5] calldata sentValues,
		bytes calldata loanDataBytes
	) external payable nonReentrant returns (uint256 newPrincipal, uint256 newCollateral) {
		require(msg.value == 0 || loanDataBytes.length != 0, "loanDataBytes required with ether");

		/// Only callable by loan pools.
		require(loanPoolToUnderlying[msg.sender] != address(0), "not authorized");

		LoanParams memory loanParamsLocal = loanParams[loanParamsId];
		require(loanParamsLocal.id != 0, "loanParams not exists");

		/// Get required collateral.
		uint256 collateralAmountRequired =
			_getRequiredCollateral(loanParamsLocal.loanToken, loanParamsLocal.collateralToken, sentValues[1], initialMargin, isTorqueLoan);
		require(collateralAmountRequired != 0, "collateral is 0");

		return
			_borrowOrTrade(
				loanParamsLocal,
				loanId,
				isTorqueLoan,
				collateralAmountRequired,
				initialMargin,
				sentAddresses,
				sentValues,
				loanDataBytes
			);
	}

	/**
	 * @notice Set the delegated manager.
	 *
	 * @dev Wrapper for _setDelegatedManager internal function.
	 *
	 * @param loanId The ID of the loan. If 0, start a new loan.
	 * @param delegated The address of the delegated manager.
	 * @param toggle The flag true/false for the delegated manager.
	 * */
	function setDelegatedManager(
		bytes32 loanId,
		address delegated,
		bool toggle
	) external {
		require(loans[loanId].borrower == msg.sender, "unauthorized");

		_setDelegatedManager(loanId, msg.sender, delegated, toggle);
	}

	/**
	 * @notice Get the estimated margin exposure.
	 *
	 * Margin is the money borrowed from a broker to purchase an investment
	 * and is the difference between the total value of investment and the
	 * loan amount. Margin trading refers to the practice of using borrowed
	 * funds from a broker to trade a financial asset, which forms the
	 * collateral for the loan from the broker.
	 *
	 * @param loanToken The loan token instance address.
	 * @param collateralToken The collateral token instance address.
	 * @param loanTokenSent The amount of loan tokens sent.
	 * @param collateralTokenSent The amount of collateral tokens sent.
	 * @param interestRate The interest rate. Percentage w/ 18 decimals.
	 * @param newPrincipal The updated amount of principal (current debt).
	 *
	 * @return The margin exposure.
	 * */
	function getEstimatedMarginExposure(
		address loanToken,
		address collateralToken,
		uint256 loanTokenSent,
		uint256 collateralTokenSent,
		uint256 interestRate,
		uint256 newPrincipal
	) external view returns (uint256) {
		uint256 maxLoanTerm = 2419200; // 28 days

		uint256 owedPerDay = newPrincipal.mul(interestRate).div(365 * 10**20);

		uint256 interestAmountRequired = maxLoanTerm.mul(owedPerDay).div(86400);

		uint256 swapAmount = loanTokenSent.sub(interestAmountRequired);
		uint256 tradingFee = _getTradingFee(swapAmount);
		if (tradingFee != 0) {
			swapAmount = swapAmount.sub(tradingFee);
		}

		uint256 receivedAmount = _swapsExpectedReturn(loanToken, collateralToken, swapAmount);
		if (receivedAmount == 0) {
			return 0;
		} else {
			return collateralTokenSent.add(receivedAmount);
		}
	}

	/**
	 * @notice Get the required collateral.
	 *
	 * @dev Calls internal _getRequiredCollateral and add fees.
	 *
	 * @param loanToken The loan token instance address.
	 * @param collateralToken The collateral token instance address.
	 * @param newPrincipal The updated amount of principal (current debt).
	 * @param marginAmount The amount of margin of the trade.
	 * @param isTorqueLoan Whether the loan is a Torque loan.
	 *
	 * @return collateralAmountRequired The required collateral.
	 * */
	function getRequiredCollateral(
		address loanToken,
		address collateralToken,
		uint256 newPrincipal,
		uint256 marginAmount,
		bool isTorqueLoan
	) public view returns (uint256 collateralAmountRequired) {
		if (marginAmount != 0) {
			collateralAmountRequired = _getRequiredCollateral(loanToken, collateralToken, newPrincipal, marginAmount, isTorqueLoan);

			// p3.9 from bzx peckshield-audit-report-bZxV2-v1.0rc1.pdf
			// cannot be applied solely as it drives to some other tests failure
			/*
			uint256 feePercent = isTorqueLoan ? borrowingFeePercent : tradingFeePercent;
			if (collateralAmountRequired != 0 && feePercent != 0) {
				collateralAmountRequired = collateralAmountRequired.mul(10**20).divCeil(
					10**20 - feePercent // never will overflow
				);
			}*/

			uint256 fee = isTorqueLoan ? _getBorrowingFee(collateralAmountRequired) : _getTradingFee(collateralAmountRequired);
			if (fee != 0) {
				collateralAmountRequired = collateralAmountRequired.add(fee);
			}
		}
	}

	/**
	 * @notice Get the borrow amount of a trade loan.
	 *
	 * @dev Basically borrowAmount = collateral / marginAmount
	 *
	 * Collateral is something that helps secure a loan. When you borrow money,
	 * you agree that your lender can take something and sell it to get their
	 * money back if you fail to repay the loan. That's the collateral.
	 *
	 * @param loanToken The loan token instance address.
	 * @param collateralToken The collateral token instance address.
	 * @param collateralTokenAmount The amount of collateral.
	 * @param marginAmount The amount of margin of the trade.
	 * @param isTorqueLoan Whether the loan is a Torque loan.
	 *
	 * @return borrowAmount The borrow amount.
	 * */
	function getBorrowAmount(
		address loanToken,
		address collateralToken,
		uint256 collateralTokenAmount,
		uint256 marginAmount,
		bool isTorqueLoan
	) public view returns (uint256 borrowAmount) {
		if (marginAmount != 0) {
			if (isTorqueLoan) {
				marginAmount = marginAmount.add(10**20); /// Adjust for over-collateralized loan.
			}
			uint256 collateral = collateralTokenAmount;
			uint256 fee = isTorqueLoan ? _getBorrowingFee(collateral) : _getTradingFee(collateral);
			if (fee != 0) {
				collateral = collateral.sub(fee);
			}
			if (loanToken == collateralToken) {
				borrowAmount = collateral.mul(10**20).div(marginAmount);
			} else {
				(uint256 sourceToDestRate, uint256 sourceToDestPrecision) = IPriceFeeds(priceFeeds).queryRate(collateralToken, loanToken);
				if (sourceToDestPrecision != 0) {
					borrowAmount = collateral.mul(10**20).div(marginAmount).mul(sourceToDestRate).div(sourceToDestPrecision);
					/*TODO: review
					borrowAmount = collateralTokenAmount.mul(10**20).mul(sourceToDestRate).div(marginAmount).div(sourceToDestPrecision);
					*/
				}
			}
			/*
			// p3.9 from bzx peckshield-audit-report-bZxV2-v1.0rc1.pdf
			// cannot be applied solely as it drives to some other tests failure
			uint256 feePercent = isTorqueLoan ? borrowingFeePercent : tradingFeePercent;
			if (borrowAmount != 0 && feePercent != 0) {
				borrowAmount = borrowAmount
					.mul(
					10**20 - feePercent // never will overflow
				)
					.divCeil(10**20);
			}*/
		}
	}

	/**
	 * @notice Borrow or trade.
	 *
	 * @param loanParamsLocal The loan parameters.
	 * @param loanId The ID of the loan. If 0, start a new loan.
	 * @param isTorqueLoan Whether the loan is a Torque loan.
	 * @param collateralAmountRequired The required amount of collateral.
	 * @param initialMargin The initial amount of margin.
	 * @param sentAddresses The addresses to send tokens: lender, borrower,
	 *   receiver and manager:
	 *     lender: must match loan if loanId provided.
	 *     borrower: must match loan if loanId provided.
	 *     receiver: receiver of funds (address(0) assumes borrower address).
	 *     manager: delegated manager of loan unless address(0).
	 * @param sentValues The values to send:
	 *     newRate: New loan interest rate.
	 *     newPrincipal: New loan size (borrowAmount + any borrowed interest).
	 *     torqueInterest: New amount of interest to escrow for Torque loan (determines initial loan length).
	 *     loanTokenReceived: Total loanToken deposit (amount not sent to borrower in the case of Torque loans).
	 *     collateralTokenReceived: Total collateralToken deposit.
	 * @param loanDataBytes The payload for the call. These loan DataBytes are
	 *   additional loan data (not in use for token swaps).
	 *
	 * @return The new loan size.
	 * @return The new collateral amount.
	 * */
	function _borrowOrTrade(
		LoanParams memory loanParamsLocal,
		bytes32 loanId,
		bool isTorqueLoan,
		uint256 collateralAmountRequired,
		uint256 initialMargin,
		address[4] memory sentAddresses,
		uint256[5] memory sentValues,
		bytes memory loanDataBytes
	) internal returns (uint256, uint256) {
		require(loanParamsLocal.collateralToken != loanParamsLocal.loanToken, "collateral/loan match");
		require(initialMargin >= loanParamsLocal.minInitialMargin, "initialMargin too low");

		/// maxLoanTerm == 0 indicates a Torque loan and requires that torqueInterest != 0
		require(
			loanParamsLocal.maxLoanTerm != 0 || sentValues[2] != 0, /// torqueInterest
			"invalid interest"
		);

		/// Initialize loan.
		Loan storage loanLocal = loans[_initializeLoan(loanParamsLocal, loanId, initialMargin, sentAddresses, sentValues)];

		// Get required interest.
		uint256 amount =
			_initializeInterest(
				loanParamsLocal,
				loanLocal,
				sentValues[0], /// newRate
				sentValues[1], /// newPrincipal,
				sentValues[2] /// torqueInterest
			);

		/// substract out interest from usable loanToken sent.
		sentValues[3] = sentValues[3].sub(amount);

		if (isTorqueLoan) {
			require(sentValues[3] == 0, "surplus loan token");

			uint256 borrowingFee = _getBorrowingFee(sentValues[4]);
			// need to temp into local state to avoid
			address _collateralToken = loanParamsLocal.collateralToken;
			address _loanToken = loanParamsLocal.loanToken;
			if (borrowingFee != 0) {
				_payBorrowingFee(
					sentAddresses[1], /// borrower
					loanLocal.id,
					_collateralToken, /// fee token
					_loanToken, /// pairToken (used to check if there is any special rebates or not) -- to pay fee reward
					borrowingFee
				);

				sentValues[4] = sentValues[4] /// collateralTokenReceived
					.sub(borrowingFee);
			}
		} else {
			/// Update collateral after trade.
			/// sentValues[3] is repurposed to hold loanToCollateralSwapRate to avoid stack too deep error.
			uint256 receivedAmount;
			(receivedAmount, , sentValues[3]) = _loanSwap(
				loanId,
				loanParamsLocal.loanToken,
				loanParamsLocal.collateralToken,
				sentAddresses[1], /// borrower
				sentValues[3], /// loanTokenUsable (minSourceTokenAmount)
				0, /// maxSourceTokenAmount (0 means minSourceTokenAmount)
				0, /// requiredDestTokenAmount (enforces that all of loanTokenUsable is swapped)
				false, /// bypassFee
				loanDataBytes
			);
			sentValues[4] = sentValues[4] /// collateralTokenReceived
				.add(receivedAmount);
		}

		/// Settle collateral.
		require(
			_isCollateralSatisfied(loanParamsLocal, loanLocal, initialMargin, sentValues[4], collateralAmountRequired),
			"collateral insufficient"
		);

		loanLocal.collateral = loanLocal.collateral.add(sentValues[4]);

		if (isTorqueLoan) {
			/// reclaiming varaible -> interestDuration
			sentValues[2] = loanLocal.endTimestamp.sub(block.timestamp);
		} else {
			/// reclaiming varaible -> entryLeverage = 100 / initialMargin
			sentValues[2] = SafeMath.div(10**38, initialMargin);
		}

		_finalizeOpen(loanParamsLocal, loanLocal, sentAddresses, sentValues, isTorqueLoan);

		return (sentValues[1], sentValues[4]); /// newPrincipal, newCollateral
	}

	/**
	 * @notice Finalize an open loan.
	 *
	 * @dev Finalize it by updating local parameters of the loan.
	 *
	 * @param loanParamsLocal The loan parameters.
	 * @param loanLocal The loan object.
	 * @param sentAddresses The addresses to send tokens: lender, borrower,
	 *   receiver and manager:
	 *     lender: must match loan if loanId provided.
	 *     borrower: must match loan if loanId provided.
	 *     receiver: receiver of funds (address(0) assumes borrower address).
	 *     manager: delegated manager of loan unless address(0).
	 * @param sentValues The values to send:
	 *     newRate: New loan interest rate.
	 *     newPrincipal: New loan size (borrowAmount + any borrowed interest).
	 *     torqueInterest: New amount of interest to escrow for Torque loan (determines initial loan length).
	 *     loanTokenReceived: Total loanToken deposit (amount not sent to borrower in the case of Torque loans).
	 *     collateralTokenReceived: Total collateralToken deposit.
	 * @param isTorqueLoan Whether the loan is a Torque loan.
	 * */
	function _finalizeOpen(
		LoanParams memory loanParamsLocal,
		Loan storage loanLocal,
		address[4] memory sentAddresses,
		uint256[5] memory sentValues,
		bool isTorqueLoan
	) internal {
		/// @dev TODO: here the actual used rate and margin should go.
		(uint256 initialMargin, uint256 collateralToLoanRate) =
			IPriceFeeds(priceFeeds).getCurrentMargin(
				loanParamsLocal.loanToken,
				loanParamsLocal.collateralToken,
				loanLocal.principal,
				loanLocal.collateral
			);
		require(initialMargin > loanParamsLocal.maintenanceMargin, "unhealthy position");

		if (loanLocal.startTimestamp == block.timestamp) {
			uint256 loanToCollateralPrecision =
				IPriceFeeds(priceFeeds).queryPrecision(loanParamsLocal.loanToken, loanParamsLocal.collateralToken);
			uint256 collateralToLoanPrecision =
				IPriceFeeds(priceFeeds).queryPrecision(loanParamsLocal.collateralToken, loanParamsLocal.loanToken);
			uint256 totalSwapRate = loanToCollateralPrecision.mul(collateralToLoanPrecision);
			loanLocal.startRate = isTorqueLoan ? collateralToLoanRate : totalSwapRate.div(sentValues[3]);
		}

		_emitOpeningEvents(loanParamsLocal, loanLocal, sentAddresses, sentValues, collateralToLoanRate, initialMargin, isTorqueLoan);
	}

	/**
	 * @notice Emit the opening events.
	 *
	 * @param loanParamsLocal The loan parameters.
	 * @param loanLocal The loan object.
	 * @param sentAddresses The addresses to send tokens: lender, borrower,
	 *   receiver and manager:
	 *     lender: must match loan if loanId provided.
	 *     borrower: must match loan if loanId provided.
	 *     receiver: receiver of funds (address(0) assumes borrower address).
	 *     manager: delegated manager of loan unless address(0).
	 * @param sentValues The values to send:
	 *     newRate: New loan interest rate.
	 *     newPrincipal: New loan size (borrowAmount + any borrowed interest).
	 *     torqueInterest: New amount of interest to escrow for Torque loan (determines initial loan length).
	 *     loanTokenReceived: Total loanToken deposit (amount not sent to borrower in the case of Torque loans).
	 *     collateralTokenReceived: Total collateralToken deposit.
	 * @param collateralToLoanRate The exchange rate from collateral to loan
	 *   tokens.
	 * @param margin The amount of margin of the trade.
	 * @param isTorqueLoan Whether the loan is a Torque loan.
	 * */
	function _emitOpeningEvents(
		LoanParams memory loanParamsLocal,
		Loan memory loanLocal,
		address[4] memory sentAddresses,
		uint256[5] memory sentValues,
		uint256 collateralToLoanRate,
		uint256 margin,
		bool isTorqueLoan
	) internal {
		if (isTorqueLoan) {
			emit Borrow(
				sentAddresses[1], /// user (borrower)
				sentAddresses[0], /// lender
				loanLocal.id, /// loanId
				loanParamsLocal.loanToken, /// loanToken
				loanParamsLocal.collateralToken, /// collateralToken
				sentValues[1], /// newPrincipal
				sentValues[4], /// newCollateral
				sentValues[0], /// interestRate
				sentValues[2], /// interestDuration
				collateralToLoanRate, /// collateralToLoanRate,
				margin /// currentMargin
			);
		} else {
			/// currentLeverage = 100 / currentMargin
			margin = SafeMath.div(10**38, margin);

			emit Trade(
				sentAddresses[1], /// user (trader)
				sentAddresses[0], /// lender
				loanLocal.id, /// loanId
				loanParamsLocal.collateralToken, /// collateralToken
				loanParamsLocal.loanToken, /// loanToken
				sentValues[4], /// positionSize
				sentValues[1], /// borrowedAmount
				sentValues[0], /// interestRate,
				loanLocal.endTimestamp, /// settlementDate
				sentValues[3], /// entryPrice (loanToCollateralSwapRate)
				sentValues[2], /// entryLeverage
				margin /// currentLeverage
			);
		}
	}

	/**
	 * @notice Set the delegated manager.
	 *
	 * @param loanId The ID of the loan. If 0, start a new loan.
	 * @param delegator The address of previous manager.
	 * @param delegated The address of the delegated manager.
	 * @param toggle The flag true/false for the delegated manager.
	 * */
	function _setDelegatedManager(
		bytes32 loanId,
		address delegator,
		address delegated,
		bool toggle
	) internal {
		delegatedManagers[loanId][delegated] = toggle;

		emit DelegatedManagerSet(loanId, delegator, delegated, toggle);
	}

	/**
	 * @notice Calculate whether the collateral is satisfied.
	 *
	 * @dev Basically check collateral + drawdown >= 98% of required.
	 *
	 * @param loanParamsLocal The loan parameters.
	 * @param loanLocal The loan object.
	 * @param initialMargin The initial amount of margin.
	 * @param newCollateral The amount of new collateral.
	 * @param collateralAmountRequired The amount of required collateral.
	 *
	 * @return Whether the collateral is satisfied.
	 * */
	function _isCollateralSatisfied(
		LoanParams memory loanParamsLocal,
		Loan memory loanLocal,
		uint256 initialMargin,
		uint256 newCollateral,
		uint256 collateralAmountRequired
	) internal view returns (bool) {
		/// Allow at most 2% under-collateralized.
		collateralAmountRequired = collateralAmountRequired.mul(98 ether).div(100 ether);

		if (newCollateral < collateralAmountRequired) {
			/// Check that existing collateral is sufficient coverage.
			if (loanLocal.collateral != 0) {
				uint256 maxDrawdown =
					IPriceFeeds(priceFeeds).getMaxDrawdown(
						loanParamsLocal.loanToken,
						loanParamsLocal.collateralToken,
						loanLocal.principal,
						loanLocal.collateral,
						initialMargin
					);
				return newCollateral.add(maxDrawdown) >= collateralAmountRequired;
			} else {
				return false;
			}
		}
		return true;
	}

	/**
	 * @notice Initialize a loan.
	 *
	 * @param loanParamsLocal The loan parameters.
	 * @param loanId The ID of the loan.
	 * @param initialMargin The amount of margin of the trade.
	 * @param sentAddresses The addresses to send tokens: lender, borrower,
	 *   receiver and manager:
	 *     lender: must match loan if loanId provided.
	 *     borrower: must match loan if loanId provided.
	 *     receiver: receiver of funds (address(0) assumes borrower address).
	 *     manager: delegated manager of loan unless address(0).
	 * @param sentValues The values to send:
	 *     newRate: New loan interest rate.
	 *     newPrincipal: New loan size (borrowAmount + any borrowed interest).
	 *     torqueInterest: New amount of interest to escrow for Torque loan (determines initial loan length).
	 *     loanTokenReceived: Total loanToken deposit (amount not sent to borrower in the case of Torque loans).
	 *     collateralTokenReceived: Total collateralToken deposit.
	 * @return The loanId.
	 * */
	function _initializeLoan(
		LoanParams memory loanParamsLocal,
		bytes32 loanId,
		uint256 initialMargin,
		address[4] memory sentAddresses,
		uint256[5] memory sentValues
	) internal returns (bytes32) {
		require(loanParamsLocal.active, "loanParams disabled");

		address lender = sentAddresses[0];
		address borrower = sentAddresses[1];
		address manager = sentAddresses[3];
		uint256 newPrincipal = sentValues[1];

		Loan memory loanLocal;

		if (loanId == 0) {
			borrowerNonce[borrower]++;
			loanId = keccak256(abi.encodePacked(loanParamsLocal.id, lender, borrower, borrowerNonce[borrower]));
			require(loans[loanId].id == 0, "loan exists");

			loanLocal = Loan({
				id: loanId,
				loanParamsId: loanParamsLocal.id,
				pendingTradesId: 0,
				active: true,
				principal: newPrincipal,
				collateral: 0, /// calculated later
				startTimestamp: block.timestamp,
				endTimestamp: 0, /// calculated later
				startMargin: initialMargin,
				startRate: 0, /// queried later
				borrower: borrower,
				lender: lender
			});

			activeLoansSet.addBytes32(loanId);
			lenderLoanSets[lender].addBytes32(loanId);
			borrowerLoanSets[borrower].addBytes32(loanId);
		} else {
			loanLocal = loans[loanId];
			require(loanLocal.active && block.timestamp < loanLocal.endTimestamp, "loan has ended");
			require(loanLocal.borrower == borrower, "borrower mismatch");
			require(loanLocal.lender == lender, "lender mismatch");
			require(loanLocal.loanParamsId == loanParamsLocal.id, "loanParams mismatch");

			loanLocal.principal = loanLocal.principal.add(newPrincipal);
		}

		if (manager != address(0)) {
			_setDelegatedManager(loanId, borrower, manager, true);
		}

		loans[loanId] = loanLocal;

		return loanId;
	}

	/**
	 * @notice Initialize a loan interest.
	 *
	 * @dev A Torque loan is an indefinite-term loan.
	 *
	 * @param loanParamsLocal The loan parameters.
	 * @param loanLocal The loan object.
	 * @param newRate The new interest rate of the loan.
	 * @param newPrincipal The new principal amount of the loan.
	 * @param torqueInterest The interest rate of the Torque loan.
	 *
	 * @return interestAmountRequired The interest amount required.
	 * */
	function _initializeInterest(
		LoanParams memory loanParamsLocal,
		Loan storage loanLocal,
		uint256 newRate,
		uint256 newPrincipal,
		uint256 torqueInterest /// ignored for fixed-term loans
	) internal returns (uint256 interestAmountRequired) {
		/// Pay outstanding interest to lender.
		_payInterest(loanLocal.lender, loanParamsLocal.loanToken);

		LoanInterest storage loanInterestLocal = loanInterest[loanLocal.id];
		LenderInterest storage lenderInterestLocal = lenderInterest[loanLocal.lender][loanParamsLocal.loanToken];

		uint256 maxLoanTerm = loanParamsLocal.maxLoanTerm;

		_settleFeeRewardForInterestExpense(
			loanInterestLocal,
			loanLocal.id,
			loanParamsLocal.loanToken, /// fee token
			loanParamsLocal.collateralToken, /// pairToken (used to check if there is any special rebates or not) -- to pay fee reward
			loanLocal.borrower,
			block.timestamp
		);

		uint256 previousDepositRemaining;
		if (maxLoanTerm == 0 && loanLocal.endTimestamp != 0) {
			previousDepositRemaining = loanLocal
				.endTimestamp
				.sub(block.timestamp) /// block.timestamp < endTimestamp was confirmed earlier.
				.mul(loanInterestLocal.owedPerDay)
				.div(86400);
		}

		uint256 owedPerDay = newPrincipal.mul(newRate).div(365 * 10**20);

		/// Update stored owedPerDay
		loanInterestLocal.owedPerDay = loanInterestLocal.owedPerDay.add(owedPerDay);
		lenderInterestLocal.owedPerDay = lenderInterestLocal.owedPerDay.add(owedPerDay);

		if (maxLoanTerm == 0) {
			/// Indefinite-term (Torque) loan.

			/// torqueInterest != 0 was confirmed earlier.
			loanLocal.endTimestamp = torqueInterest.add(previousDepositRemaining).mul(86400).div(loanInterestLocal.owedPerDay).add(
				block.timestamp
			);

			maxLoanTerm = loanLocal.endTimestamp.sub(block.timestamp);

			/// Loan term has to at least be greater than one hour.
			require(maxLoanTerm > 3600, "loan too short");

			interestAmountRequired = torqueInterest;
		} else {
			/// Fixed-term loan.

			if (loanLocal.endTimestamp == 0) {
				loanLocal.endTimestamp = block.timestamp.add(maxLoanTerm);
			}

			interestAmountRequired = loanLocal.endTimestamp.sub(block.timestamp).mul(owedPerDay).div(86400);
		}

		loanInterestLocal.depositTotal = loanInterestLocal.depositTotal.add(interestAmountRequired);

		/// Update remaining lender interest values.
		lenderInterestLocal.principalTotal = lenderInterestLocal.principalTotal.add(newPrincipal);
		lenderInterestLocal.owedTotal = lenderInterestLocal.owedTotal.add(interestAmountRequired);
	}

	/**
	 * @notice Get the required collateral.
	 *
	 * @dev Basically collateral = newPrincipal * marginAmount
	 *
	 * @param loanToken The loan token instance address.
	 * @param collateralToken The collateral token instance address.
	 * @param newPrincipal The updated amount of principal (current debt).
	 * @param marginAmount The amount of margin of the trade.
	 * @param isTorqueLoan Whether the loan is a Torque loan.
	 *
	 * @return collateralTokenAmount The required collateral.
	 * */
	function _getRequiredCollateral(
		address loanToken,
		address collateralToken,
		uint256 newPrincipal,
		uint256 marginAmount,
		bool isTorqueLoan
	) internal view returns (uint256 collateralTokenAmount) {
		if (loanToken == collateralToken) {
			collateralTokenAmount = newPrincipal.mul(marginAmount).div(10**20);
		} else {
			/// Using the price feed instead of the swap expected return
			/// because we need the rate in the inverse direction
			/// so the swap is probably farther off than the price feed.
			(uint256 sourceToDestRate, uint256 sourceToDestPrecision) = IPriceFeeds(priceFeeds).queryRate(collateralToken, loanToken);
			if (sourceToDestRate != 0) {
				collateralTokenAmount = newPrincipal.mul(sourceToDestPrecision).div(sourceToDestRate).mul(marginAmount).div(10**20);
				/*TODO: review
				collateralTokenAmount = newPrincipal.mul(sourceToDestPrecision).mul(marginAmount).div(sourceToDestRate).div(10**20);*/
			}
		}
		// ./tests-js/loan-token/TradingTestToken.test.js
		if (isTorqueLoan && collateralTokenAmount != 0) {
			collateralTokenAmount = collateralTokenAmount.mul(10**20).div(marginAmount).add(collateralTokenAmount);
		}
	}
}
