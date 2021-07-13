/**
 * Copyright 2017-2021, bZeroX, LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0.
 */

pragma solidity 0.5.17;

import "../core/State.sol";
import "../openzeppelin/SafeERC20.sol";
import "../feeds/IPriceFeeds.sol";
import "../events/FeesEvents.sol";
import "../modules/interfaces/ProtocolAffiliatesInterface.sol";
import "../core/objects/LoanParamsStruct.sol";

/**
 * @title The Fees Helper contract.
 * @notice This contract code comes from bZx. bZx is a protocol for tokenized margin
 * trading and lending https://bzx.network similar to the dYdX protocol.
 *
 * This contract calculates and pays lending/borrow fees and rewards.
 * */
contract FeesHelper is State, FeesEvents {
	using SafeERC20 for IERC20;

	/**
	 * @notice Calculate trading fee.
	 * @param feeTokenAmount The amount of tokens to trade.
	 * @return The fee of the trade.
	 * */
	function _getTradingFee(uint256 feeTokenAmount) internal view returns (uint256) {
		return feeTokenAmount.mul(tradingFeePercent).divCeil(10**20);
	}

	/*
	// p3.9 from bzx peckshield-audit-report-bZxV2-v1.0rc1.pdf
	// cannot be applied solely nor with LoanOpenings.sol as it drives to some other tests failure
	function _getTradingFee(uint256 feeTokenAmount) internal view returns (uint256) {
		uint256 collateralAmountRequired =
			feeTokenAmount.mul(10**20).divCeil(
				10**20 - tradingFeePercent // never will overflow
			);
		return collateralAmountRequired.sub(feeTokenAmount);
	}*/

	/**
	 * @notice Calculate the loan origination fee.
	 * @param feeTokenAmount The amount of tokens to borrow.
	 * @return The fee of the loan.
	 * */
	function _getBorrowingFee(uint256 feeTokenAmount) internal view returns (uint256) {
		return feeTokenAmount.mul(borrowingFeePercent).divCeil(10**20);
		/*
		// p3.9 from bzx peckshield-audit-report-bZxV2-v1.0rc1.pdf
		// cannot be applied solely nor with LoanOpenings.sol as it drives to some other tests failure
		uint256 collateralAmountRequired =
			feeTokenAmount.mul(10**20).divCeil(
				10**20 - borrowingFeePercent // never will overflow
			);
		return collateralAmountRequired.sub(feeTokenAmount);*/
	}

	/**
	 * @dev settles the trading fee and pays the token reward to the user.
	 * @param referrer the affiliate referrer address to send the reward to
	 * @param feeToken the address of the token in which the trading fee is paid
	 * @return affiliatesBonusSOVAmount the total SOV amount that is distributed to the referrer
	 * @return affiliatesBonusTokenAmount the total Token Base on the trading fee pairs that is distributed to the referrer
	 * */

	function _payTradingFeeToAffiliate(
		address referrer,
		address trader,
		address feeToken,
		uint256 tradingFee
	) internal returns (uint256 affiliatesBonusSOVAmount, uint256 affiliatesBonusTokenAmount) {
		(affiliatesBonusSOVAmount, affiliatesBonusTokenAmount) = ProtocolAffiliatesInterface(protocolAddress)
			.payTradingFeeToAffiliatesReferrer(referrer, trader, feeToken, tradingFee);
	}

	/**
	 * @notice Settle the trading fee and pay the token reward to the user.
	 * @param user The address to send the reward to.
	 * @param loanId The Id of the associated loan - used for logging only.
	 * @param feeToken The address of the token in which the trading fee is paid.
	 * */

	function _payTradingFee(
		address user,
		bytes32 loanId,
		address feeToken,
		address feeTokenPair,
		uint256 tradingFee
	) internal {
		uint256 protocolTradingFee = tradingFee; //trading fee paid to protocol
		if (tradingFee != 0) {
			if (affiliatesUserReferrer[user] != address(0)) {
				_payTradingFeeToAffiliate(affiliatesUserReferrer[user], user, feeToken, protocolTradingFee);
				protocolTradingFee = (protocolTradingFee.sub(protocolTradingFee.mul(affiliateFeePercent).div(10**20))).sub(
					protocolTradingFee.mul(affiliateTradingTokenFeePercent).div(10**20)
				);
			}

			/// Increase the storage variable keeping track of the accumulated fees.
			tradingFeeTokensHeld[feeToken] = tradingFeeTokensHeld[feeToken].add(protocolTradingFee);

			emit PayTradingFee(user, feeToken, loanId, protocolTradingFee);

			/// Pay the token reward to the user.
			_payFeeReward(user, loanId, feeToken, feeTokenPair, tradingFee);
		}
	}

	/**
	 * @notice Settle the borrowing fee and pay the token reward to the user.
	 * @param user The address to send the reward to.
	 * @param loanId The Id of the associated loan - used for logging only.
	 * @param feeToken The address of the token in which the borrowig fee is paid.
	 * @param borrowingFee The height of the fee.
	 * */
	function _payBorrowingFee(
		address user,
		bytes32 loanId,
		address feeToken,
		address feeTokenPair,
		uint256 borrowingFee
	) internal {
		if (borrowingFee != 0) {
			/// Increase the storage variable keeping track of the accumulated fees.
			borrowingFeeTokensHeld[feeToken] = borrowingFeeTokensHeld[feeToken].add(borrowingFee);

			emit PayBorrowingFee(user, feeToken, loanId, borrowingFee);

			/// Pay the token reward to the user.
			_payFeeReward(user, loanId, feeToken, feeTokenPair, borrowingFee);
		}
	}

	/**
	 * @notice Settle the lending fee (based on the interest). Pay no token reward to the user.
	 * @param user The address to send the reward to.
	 * @param feeToken The address of the token in which the lending fee is paid.
	 * @param lendingFee The height of the fee.
	 * */
	function _payLendingFee(
		address user,
		address feeToken,
		uint256 lendingFee
	) internal {
		if (lendingFee != 0) {
			/// Increase the storage variable keeping track of the accumulated fees.
			lendingFeeTokensHeld[feeToken] = lendingFeeTokensHeld[feeToken].add(lendingFee);

			emit PayLendingFee(user, feeToken, lendingFee);

			//// NOTE: Lenders do not receive a fee reward ////
		}
	}

	/// Settle and pay borrowers based on the fees generated by their interest payments.
	function _settleFeeRewardForInterestExpense(
		LoanInterest storage loanInterestLocal,
		bytes32 loanId,
		address feeToken,
		address feeTokenPair,
		address user,
		uint256 interestTime
	) internal {
		/// This represents the fee generated by a borrower's interest payment.
		uint256 interestExpenseFee =
			interestTime.sub(loanInterestLocal.updatedTimestamp).mul(loanInterestLocal.owedPerDay).mul(lendingFeePercent).div(
				1 days * 10**20
			);

		loanInterestLocal.updatedTimestamp = interestTime;

		if (interestExpenseFee != 0) {
			_payFeeReward(user, loanId, feeToken, feeTokenPair, interestExpenseFee);
		}
	}

	/**
	 * @notice Pay the potocolToken reward to user. The reward is worth 50% of the trading/borrowing fee.
	 * @param user The address to send the reward to.
	 * @param loanId The Id of the associeated loan - used for logging only.
	 * @param feeToken The address of the token in which the trading/borrowing fee was paid.
	 * @param feeAmount The height of the fee.
	 * */
	function _payFeeReward(
		address user,
		bytes32 loanId,
		address feeToken,
		address feeTokenPair,
		uint256 feeAmount
	) internal {
		uint256 rewardAmount;
		uint256 _feeRebatePercent = feeRebatePercent;
		address _priceFeeds = priceFeeds;

		if (specialRebates[feeToken][feeTokenPair] > 0) {
			_feeRebatePercent = specialRebates[feeToken][feeTokenPair];
		}

		/// Note: this should be refactored.
		/// Calculate the reward amount, querying the price feed.
		(bool success, bytes memory data) =
			_priceFeeds.staticcall(
				abi.encodeWithSelector(
					IPriceFeeds(_priceFeeds).queryReturn.selector,
					feeToken,
					sovTokenAddress, /// Price rewards using BZRX price rather than vesting token price.
					feeAmount.mul(_feeRebatePercent).div(10**20)
				)
			);
		assembly {
			if eq(success, 1) {
				rewardAmount := mload(add(data, 32))
			}
		}

		if (rewardAmount != 0) {
			IERC20(sovTokenAddress).approve(lockedSOVAddress, rewardAmount);

			(bool success, ) = lockedSOVAddress.call(abi.encodeWithSignature("depositSOV(address,uint256)", user, rewardAmount));

			if (success) {
				protocolTokenPaid = protocolTokenPaid.add(rewardAmount);

				emit EarnReward(user, sovTokenAddress, loanId, _feeRebatePercent, rewardAmount);
			} else {
				emit EarnRewardFail(user, sovTokenAddress, loanId, _feeRebatePercent, rewardAmount);
			}
		}
	}
}
