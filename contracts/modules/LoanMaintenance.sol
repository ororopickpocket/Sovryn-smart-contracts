/**
 * Copyright 2017-2020, bZeroX, LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0.
 */

pragma solidity 0.5.17;
pragma experimental ABIEncoderV2;

import "../core/State.sol";
import "../events/LoanOpeningsEvents.sol";
import "../events/LoanMaintenanceEvents.sol";
import "../mixins/VaultController.sol";
import "../mixins/InterestUser.sol";
import "../mixins/LiquidationHelper.sol";
import "../swaps/SwapsUser.sol";
import "./ModuleCommonFunctionalities.sol";

/**
 * @title Loan Maintenance contract.
 *
 * @notice This contract code comes from bZx. bZx is a protocol for tokenized
 * margin trading and lending https://bzx.network similar to the dYdX protocol.
 *
 * This contract contains functions to query loan data and to modify its status
 * by withdrawing or depositing collateral.
 * */
contract LoanMaintenance is
	LoanOpeningsEvents,
	LoanMaintenanceEvents,
	VaultController,
	InterestUser,
	SwapsUser,
	LiquidationHelper,
	ModuleCommonFunctionalities
{
	struct LoanReturnData {
		bytes32 loanId;
		address loanToken;
		address collateralToken;
		uint256 principal;
		uint256 collateral;
		uint256 interestOwedPerDay;
		uint256 interestDepositRemaining;
		uint256 startRate; /// collateralToLoanRate
		uint256 startMargin;
		uint256 maintenanceMargin;
		uint256 currentMargin;
		uint256 maxLoanTerm;
		uint256 endTimestamp;
		uint256 maxLiquidatable;
		uint256 maxSeizable;
	}

	/**
	 * @notice Empty public constructor.
	 * */
	constructor() public {}

	/**
	 * @notice Fallback function is to react to receiving value (rBTC).
	 * */
	function() external {
		revert("fallback not allowed");
	}

	/**
	 * @notice Set initial values of proxy targets.
	 *
	 * @param target The address of the logic contract instance.
	 * */
	function initialize(address target) external onlyOwner {
		_setTarget(this.depositCollateral.selector, target);
		_setTarget(this.withdrawCollateral.selector, target);
		_setTarget(this.withdrawAccruedInterest.selector, target);
		_setTarget(this.extendLoanDuration.selector, target);
		_setTarget(this.reduceLoanDuration.selector, target);
		_setTarget(this.getLenderInterestData.selector, target);
		_setTarget(this.getLoanInterestData.selector, target);
		_setTarget(this.getUserLoans.selector, target);
		_setTarget(this.getLoan.selector, target);
		_setTarget(this.getActiveLoans.selector, target);
	}

	/**
	 * @notice Increase the margin of a position by depositing additional collateral.
	 *
	 * @param loanId A unique ID representing the loan.
	 * @param depositAmount The amount to be deposited in collateral tokens.
	 *
	 * @return actualWithdrawAmount The amount withdrawn taking into account drawdowns.
	 * */
	function depositCollateral(
		bytes32 loanId,
		uint256 depositAmount /// must match msg.value if ether is sent
	) external payable nonReentrant whenNotPaused {
		require(depositAmount != 0, "depositAmount is 0");
		Loan storage loanLocal = loans[loanId];
		LoanParams storage loanParamsLocal = loanParams[loanLocal.loanParamsId];

		require(loanLocal.active, "loan is closed");
		require(msg.value == 0 || loanParamsLocal.collateralToken == address(wrbtcToken), "wrong asset sent");

		loanLocal.collateral = loanLocal.collateral.add(depositAmount);

		if (msg.value == 0) {
			vaultDeposit(loanParamsLocal.collateralToken, msg.sender, depositAmount);
		} else {
			require(msg.value == depositAmount, "ether deposit mismatch");
			vaultEtherDeposit(msg.sender, msg.value);
		}

		(uint256 collateralToLoanRate, ) = IPriceFeeds(priceFeeds).queryRate(loanParamsLocal.collateralToken, loanParamsLocal.loanToken);

		emit DepositCollateral(loanId, depositAmount, collateralToLoanRate);
	}

	/**
	 * @notice Withdraw from the collateral. This reduces the margin of a position.
	 *
	 * @param loanId A unique ID representing the loan.
	 * @param receiver The account getting the withdrawal.
	 * @param withdrawAmount The amount to be withdrawn in collateral tokens.
	 *
	 * @return actualWithdrawAmount The amount withdrawn taking into account drawdowns.
	 * */
	function withdrawCollateral(
		bytes32 loanId,
		address receiver,
		uint256 withdrawAmount
	) external nonReentrant whenNotPaused returns (uint256 actualWithdrawAmount) {
		require(withdrawAmount != 0, "withdrawAmount is 0");
		Loan storage loanLocal = loans[loanId];
		LoanParams storage loanParamsLocal = loanParams[loanLocal.loanParamsId];

		require(loanLocal.active, "loan is closed");
		require(msg.sender == loanLocal.borrower || delegatedManagers[loanLocal.id][msg.sender], "unauthorized");

		uint256 maxDrawdown =
			IPriceFeeds(priceFeeds).getMaxDrawdown(
				loanParamsLocal.loanToken,
				loanParamsLocal.collateralToken,
				loanLocal.principal,
				loanLocal.collateral,
				loanParamsLocal.maintenanceMargin
			);

		if (withdrawAmount > maxDrawdown) {
			actualWithdrawAmount = maxDrawdown;
		} else {
			actualWithdrawAmount = withdrawAmount;
		}

		loanLocal.collateral = loanLocal.collateral.sub(actualWithdrawAmount);

		if (loanParamsLocal.collateralToken == address(wrbtcToken)) {
			vaultEtherWithdraw(receiver, actualWithdrawAmount);
		} else {
			vaultWithdraw(loanParamsLocal.collateralToken, receiver, actualWithdrawAmount);
		}
	}

	/**
	 * @notice Withdraw accrued loan interest.
	 *
	 * @dev Wrapper for _payInterest internal function.
	 *
	 * @param loanToken The loan token address.
	 * */
	function withdrawAccruedInterest(address loanToken) external whenNotPaused {
		/// Pay outstanding interest to lender.
		_payInterest(
			msg.sender, /// Lender.
			loanToken
		);
	}

	/**
	 * @notice Extend the loan duration by as much time as depositAmount can buy.
	 *
	 * @param loanId A unique ID representing the loan.
	 * @param depositAmount The amount to be deposited in loan tokens. Used to pay the interest for the new duration.
	 * @param useCollateral Whether pay interests w/ the collateral. If true, depositAmount of loan tokens
	 *						will be purchased with the collateral.
	 * // param calldata The payload for the call. These loan DataBytes are additional loan data (not in use for token swaps).
	 *
	 * @return secondsExtended The amount of time in seconds the loan is extended.
	 * */
	function extendLoanDuration(
		bytes32 loanId,
		uint256 depositAmount,
		bool useCollateral,
		bytes calldata /// loanDataBytes, for future use.
	) external payable nonReentrant whenNotPaused returns (uint256 secondsExtended) {
		require(depositAmount != 0, "depositAmount is 0");
		Loan storage loanLocal = loans[loanId];
		LoanParams storage loanParamsLocal = loanParams[loanLocal.loanParamsId];

		require(loanLocal.active, "loan is closed");
		require(!useCollateral || msg.sender == loanLocal.borrower || delegatedManagers[loanLocal.id][msg.sender], "unauthorized");
		require(loanParamsLocal.maxLoanTerm == 0, "indefinite-term only");
		require(msg.value == 0 || (!useCollateral && loanParamsLocal.loanToken == address(wrbtcToken)), "wrong asset sent");

		/// Pay outstanding interest to lender.
		_payInterest(loanLocal.lender, loanParamsLocal.loanToken);

		LoanInterest storage loanInterestLocal = loanInterest[loanLocal.id];

		_settleFeeRewardForInterestExpense(loanInterestLocal, loanLocal.id, loanParamsLocal.loanToken, loanLocal.borrower, block.timestamp);

		/// Handle back interest: calculates interest owned since the loan
		/// endtime passed but the loan remained open.
		uint256 backInterestOwed;
		if (block.timestamp > loanLocal.endTimestamp) {
			backInterestOwed = block.timestamp.sub(loanLocal.endTimestamp);
			backInterestOwed = backInterestOwed.mul(loanInterestLocal.owedPerDay);
			backInterestOwed = backInterestOwed.div(86400);

			require(depositAmount > backInterestOwed, "deposit cannot cover back interest");
		}

		/// Deposit interest.
		if (useCollateral) {
			_doCollateralSwap(loanLocal, loanParamsLocal, depositAmount);
		} else {
			if (msg.value == 0) {
				vaultDeposit(loanParamsLocal.loanToken, msg.sender, depositAmount);
			} else {
				require(msg.value == depositAmount, "ether deposit mismatch");
				vaultEtherDeposit(msg.sender, msg.value);
			}
		}

		if (backInterestOwed != 0) {
			depositAmount = depositAmount.sub(backInterestOwed);

			/// Pay out backInterestOwed
			_payInterestTransfer(loanLocal.lender, loanParamsLocal.loanToken, backInterestOwed);
		}

		secondsExtended = depositAmount.mul(86400).div(loanInterestLocal.owedPerDay);

		loanLocal.endTimestamp = loanLocal.endTimestamp.add(secondsExtended);

		require(loanLocal.endTimestamp > block.timestamp, "loan too short");

		uint256 maxDuration = loanLocal.endTimestamp.sub(block.timestamp);

		/// Loan term has to at least be greater than one hour.
		require(maxDuration > 3600, "loan too short");

		loanInterestLocal.depositTotal = loanInterestLocal.depositTotal.add(depositAmount);

		lenderInterest[loanLocal.lender][loanParamsLocal.loanToken].owedTotal = lenderInterest[loanLocal.lender][loanParamsLocal.loanToken]
			.owedTotal
			.add(depositAmount);
	}

	/**
	 * @notice Reduce the loan duration by withdrawing from the deposited interest.
	 *
	 * @param loanId A unique ID representing the loan.
	 * @param receiver The account getting the withdrawal.
	 * @param withdrawAmount The amount to be withdrawn in loan tokens.
	 *
	 * @return secondsReduced The amount of time in seconds the loan is reduced.
	 * */
	function reduceLoanDuration(
		bytes32 loanId,
		address receiver,
		uint256 withdrawAmount
	) external nonReentrant whenNotPaused returns (uint256 secondsReduced) {
		require(withdrawAmount != 0, "withdrawAmount is 0");
		Loan storage loanLocal = loans[loanId];
		LoanParams storage loanParamsLocal = loanParams[loanLocal.loanParamsId];

		require(loanLocal.active, "loan is closed");
		require(msg.sender == loanLocal.borrower || delegatedManagers[loanLocal.id][msg.sender], "unauthorized");
		require(loanParamsLocal.maxLoanTerm == 0, "indefinite-term only");
		require(loanLocal.endTimestamp > block.timestamp, "loan term has ended");

		/// Pay outstanding interest to lender.
		_payInterest(loanLocal.lender, loanParamsLocal.loanToken);

		LoanInterest storage loanInterestLocal = loanInterest[loanLocal.id];

		_settleFeeRewardForInterestExpense(loanInterestLocal, loanLocal.id, loanParamsLocal.loanToken, loanLocal.borrower, block.timestamp);

		uint256 interestDepositRemaining = loanLocal.endTimestamp.sub(block.timestamp).mul(loanInterestLocal.owedPerDay).div(86400);
		require(withdrawAmount < interestDepositRemaining, "withdraw amount too high");

		/// Withdraw interest.
		if (loanParamsLocal.loanToken == address(wrbtcToken)) {
			vaultEtherWithdraw(receiver, withdrawAmount);
		} else {
			vaultWithdraw(loanParamsLocal.loanToken, receiver, withdrawAmount);
		}

		secondsReduced = withdrawAmount.mul(86400).div(loanInterestLocal.owedPerDay);

		require(loanLocal.endTimestamp > secondsReduced, "loan too short");

		loanLocal.endTimestamp = loanLocal.endTimestamp.sub(secondsReduced);

		require(loanLocal.endTimestamp > block.timestamp, "loan too short");

		uint256 maxDuration = loanLocal.endTimestamp.sub(block.timestamp);

		/// Loan term has to at least be greater than one hour.
		require(maxDuration > 3600, "loan too short");

		loanInterestLocal.depositTotal = loanInterestLocal.depositTotal.sub(withdrawAmount);

		lenderInterest[loanLocal.lender][loanParamsLocal.loanToken].owedTotal = lenderInterest[loanLocal.lender][loanParamsLocal.loanToken]
			.owedTotal
			.sub(withdrawAmount);
	}

	/**
	 * @notice Get current lender interest data totals for all loans
	 *   with a specific oracle and interest token.
	 *
	 * @param lender The lender address.
	 * @param loanToken The loan token address.
	 *
	 * @return interestPaid The total amount of interest that has been paid to a lender so far.
	 * @return interestPaidDate The date of the last interest pay out, or 0 if no interest has been withdrawn yet.
	 * @return interestOwedPerDay The amount of interest the lender is earning per day.
	 * @return interestUnPaid The total amount of interest the lender is owned and not yet withdrawn.
	 * @return interestFeePercent The fee retained by the protocol before interest is paid to the lender.
	 * @return principalTotal The total amount of outstanding principal the lender has loaned.
	 * */
	function getLenderInterestData(address lender, address loanToken)
		external
		view
		returns (
			uint256 interestPaid,
			uint256 interestPaidDate,
			uint256 interestOwedPerDay,
			uint256 interestUnPaid,
			uint256 interestFeePercent,
			uint256 principalTotal
		)
	{
		LenderInterest memory lenderInterestLocal = lenderInterest[lender][loanToken];

		interestUnPaid = block.timestamp.sub(lenderInterestLocal.updatedTimestamp).mul(lenderInterestLocal.owedPerDay).div(86400);
		if (interestUnPaid > lenderInterestLocal.owedTotal) interestUnPaid = lenderInterestLocal.owedTotal;

		return (
			lenderInterestLocal.paidTotal,
			lenderInterestLocal.paidTotal != 0 ? lenderInterestLocal.updatedTimestamp : 0,
			lenderInterestLocal.owedPerDay,
			lenderInterestLocal.updatedTimestamp != 0 ? interestUnPaid : 0,
			lendingFeePercent,
			lenderInterestLocal.principalTotal
		);
	}

	/**
	 * @notice Get current interest data for a loan.
	 *
	 * @param loanId A unique ID representing the loan.
	 *
	 * @return loanToken The loan token that interest is paid in.
	 * @return interestOwedPerDay The amount of interest the borrower is paying per day.
	 * @return interestDepositTotal The total amount of interest the borrower has deposited.
	 * @return interestDepositRemaining The amount of deposited interest that is not yet owed to a lender.
	 * */
	function getLoanInterestData(bytes32 loanId)
		external
		view
		returns (
			address loanToken,
			uint256 interestOwedPerDay,
			uint256 interestDepositTotal,
			uint256 interestDepositRemaining
		)
	{
		loanToken = loanParams[loans[loanId].loanParamsId].loanToken;
		interestOwedPerDay = loanInterest[loanId].owedPerDay;
		interestDepositTotal = loanInterest[loanId].depositTotal;

		uint256 endTimestamp = loans[loanId].endTimestamp;
		uint256 interestTime = block.timestamp > endTimestamp ? endTimestamp : block.timestamp;
		interestDepositRemaining = endTimestamp > interestTime ? endTimestamp.sub(interestTime).mul(interestOwedPerDay).div(86400) : 0;
	}

	/**
	 * @notice Get all user loans.
	 *
	 * Only returns data for loans that are active.
	 *
	 * @param user The user address.
	 * @param start The lower loan ID to start with.
	 * @param count The maximum number of results.
	 * @param loanType The type of loan.
	 *   loanType 0: all loans.
	 *   loanType 1: margin trade loans.
	 *   loanType 2: non-margin trade loans.
	 * @param isLender Whether the user is lender or borrower.
	 * @param unsafeOnly The safe filter (True/False).
	 *
	 * @return loansData The array of loans as query result.
	 * */
	function getUserLoans(
		address user,
		uint256 start,
		uint256 count,
		uint256 loanType,
		bool isLender,
		bool unsafeOnly
	) external view returns (LoanReturnData[] memory loansData) {
		EnumerableBytes32Set.Bytes32Set storage set = isLender ? lenderLoanSets[user] : borrowerLoanSets[user];

		uint256 end = start.add(count).min256(set.length());
		if (start >= end) {
			return loansData;
		}

		loansData = new LoanReturnData[](count);
		uint256 itemCount;
		for (uint256 i = end - start; i > 0; i--) {
			if (itemCount == count) {
				break;
			}
			LoanReturnData memory loanData =
				_getLoan(
					set.get(i + start - 1), /// loanId
					loanType,
					unsafeOnly
				);
			if (loanData.loanId == 0) continue;

			loansData[itemCount] = loanData;
			itemCount++;
		}

		if (itemCount < count) {
			assembly {
				mstore(loansData, itemCount)
			}
		}
	}

	/**
	 * @notice Get one loan data structure by matching ID.
	 *
	 * Wrapper to internal _getLoan call.
	 *
	 * @param loanId A unique ID representing the loan.
	 *
	 * @return loansData The data structure w/ loan information.
	 * */
	function getLoan(bytes32 loanId) external view returns (LoanReturnData memory loanData) {
		return
			_getLoan(
				loanId,
				0, /// loanType
				false /// unsafeOnly
			);
	}

	/**
	 * @notice Get all active loans.
	 *
	 * @param start The lower loan ID to start with.
	 * @param count The maximum number of results.
	 * @param unsafeOnly The safe filter (True/False).
	 *
	 * @return loansData The data structure w/ loan information.
	 * */
	function getActiveLoans(
		uint256 start,
		uint256 count,
		bool unsafeOnly
	) external view returns (LoanReturnData[] memory loansData) {
		uint256 end = start.add(count).min256(activeLoansSet.length());
		if (start >= end) {
			return loansData;
		}

		loansData = new LoanReturnData[](count);
		uint256 itemCount;
		for (uint256 i = end - start; i > 0; i--) {
			if (itemCount == count) {
				break;
			}
			LoanReturnData memory loanData =
				_getLoan(
					activeLoansSet.get(i + start - 1), /// loanId
					0, /// loanType
					unsafeOnly
				);
			if (loanData.loanId == 0) continue;

			loansData[itemCount] = loanData;
			itemCount++;
		}

		if (itemCount < count) {
			assembly {
				mstore(loansData, itemCount)
			}
		}
	}

	/**
	 * @notice Internal function to get one loan data structure.
	 *
	 * @param loanId A unique ID representing the loan.
	 * @param loanType The type of loan.
	 *   loanType 0: all loans.
	 *   loanType 1: margin trade loans.
	 *   loanType 2: non-margin trade loans.
	 * @param unsafeOnly The safe filter (True/False).
	 *
	 * @return loansData The data structure w/ the loan information.
	 * */
	function _getLoan(
		bytes32 loanId,
		uint256 loanType,
		bool unsafeOnly
	) internal view returns (LoanReturnData memory loanData) {
		Loan memory loanLocal = loans[loanId];
		LoanParams memory loanParamsLocal = loanParams[loanLocal.loanParamsId];

		if (loanType != 0) {
			if (!((loanType == 1 && loanParamsLocal.maxLoanTerm != 0) || (loanType == 2 && loanParamsLocal.maxLoanTerm == 0))) {
				return loanData;
			}
		}

		LoanInterest memory loanInterestLocal = loanInterest[loanId];

		(uint256 currentMargin, uint256 collateralToLoanRate) =
			IPriceFeeds(priceFeeds).getCurrentMargin(
				loanParamsLocal.loanToken,
				loanParamsLocal.collateralToken,
				loanLocal.principal,
				loanLocal.collateral
			);

		uint256 maxLiquidatable;
		uint256 maxSeizable;
		if (currentMargin <= loanParamsLocal.maintenanceMargin) {
			(maxLiquidatable, maxSeizable, ) = _getLiquidationAmounts(
				loanLocal.principal,
				loanLocal.collateral,
				currentMargin,
				loanParamsLocal.maintenanceMargin,
				collateralToLoanRate
			);
		} else if (unsafeOnly) {
			return loanData;
		}

		return
			LoanReturnData({
				loanId: loanId,
				loanToken: loanParamsLocal.loanToken,
				collateralToken: loanParamsLocal.collateralToken,
				principal: loanLocal.principal,
				collateral: loanLocal.collateral,
				interestOwedPerDay: loanInterestLocal.owedPerDay,
				interestDepositRemaining: loanLocal.endTimestamp >= block.timestamp
					? loanLocal.endTimestamp.sub(block.timestamp).mul(loanInterestLocal.owedPerDay).div(86400)
					: 0,
				startRate: loanLocal.startRate,
				startMargin: loanLocal.startMargin,
				maintenanceMargin: loanParamsLocal.maintenanceMargin,
				currentMargin: currentMargin,
				maxLoanTerm: loanParamsLocal.maxLoanTerm,
				endTimestamp: loanLocal.endTimestamp,
				maxLiquidatable: maxLiquidatable,
				maxSeizable: maxSeizable
			});
	}

	/**
	 * @notice Internal function to collect interest from the collateral.
	 *
	 * @param loanLocal The loan object.
	 * @param loanParamsLocal The loan parameters.
	 * @param depositAmount The amount of underlying tokens provided on the loan.
	 * */
	function _doCollateralSwap(
		Loan storage loanLocal,
		LoanParams memory loanParamsLocal,
		uint256 depositAmount
	) internal {
		/// Reverts in _loanSwap if amountNeeded can't be bought.
		(, uint256 sourceTokenAmountUsed, ) =
			_loanSwap(
				loanLocal.id,
				loanParamsLocal.collateralToken,
				loanParamsLocal.loanToken,
				loanLocal.borrower,
				loanLocal.collateral, /// minSourceTokenAmount
				0, /// maxSourceTokenAmount (0 means minSourceTokenAmount)
				depositAmount, /// requiredDestTokenAmount (partial spend of loanLocal.collateral to fill this amount)
				true, /// bypassFee
				"" /// loanDataBytes
			);
		loanLocal.collateral = loanLocal.collateral.sub(sourceTokenAmountUsed);

		/// Ensure the loan is still healthy.
		(uint256 currentMargin, ) =
			IPriceFeeds(priceFeeds).getCurrentMargin(
				loanParamsLocal.loanToken,
				loanParamsLocal.collateralToken,
				loanLocal.principal,
				loanLocal.collateral
			);
		require(currentMargin > loanParamsLocal.maintenanceMargin, "unhealthy position");
	}
}
