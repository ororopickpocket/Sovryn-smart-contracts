/**
 * Copyright 2017-2020, Sovryn, All Rights Reserved.
 * Licensed under the Apache License, Version 2.0.
 */

pragma solidity 0.5.17;
pragma experimental ABIEncoderV2;

import "../core/State.sol";
import "../mixins/EnumerableBytes32Set.sol";
import "../openzeppelin/SafeERC20.sol";
import "../events/AffiliatesEvents.sol";
import "../feeds/IPriceFeeds.sol";
import "../locked/ILockedSOV.sol";

contract Affiliates is State, AffiliatesEvents {
	/*
    Module: Affiliates upgradable
    Storage: from State, functions called from Protocol by delegatecall
    */

	using SafeERC20 for IERC20;

	constructor() public {}

	function() external {
		revert("Affiliates - fallback not allowed");
	}

	function initialize(address target) external onlyOwner {
		_setTarget(this.setAffiliatesReferrer.selector, target);
		_setTarget(this.getUserNotFirstTradeFlag.selector, target);
		_setTarget(this.getReferralsList.selector, target);
		_setTarget(this.setUserNotFirstTradeFlag.selector, target);
		_setTarget(this.payTradingFeeToAffiliatesReferrer.selector, target);
		_setTarget(this.getAffiliatesReferrerBalances.selector, target);
		_setTarget(this.getAffiliatesReferrerTokenBalance.selector, target);
		_setTarget(this.getAffiliatesReferrerTokensList.selector, target);
		_setTarget(this.withdrawAffiliatesReferrerTokenFees.selector, target);
		_setTarget(this.withdrawAllAffiliatesReferrerTokenFees.selector, target);
		_setTarget(this.getMinReferralsToPayout.selector, target);
		_setTarget(this.getAffiliatesUserReferrer.selector, target);
		_setTarget(this.getAffiliateRewardsHeld.selector, target);
		_setTarget(this.getAffiliateTradingTokenFeePercent.selector, target);
	}

	modifier onlyCallableByLoanPools() {
		require(loanPoolToUnderlying[msg.sender] != address(0), "Affiliates: not authorized");
		_;
	}

	// only allowed to be called from within protocol functions
	modifier onlyCallableInternal() {
		require(msg.sender == protocolAddress, "Affiliates: not authorized");
		_;
	}

	struct SetAffiliatesReferrerResult {
		bool success;
		bool alreadySet;
		bool userNotFirstTradeFlag;
	}

	function setAffiliatesReferrer(address user, address referrer) external onlyCallableByLoanPools {
		SetAffiliatesReferrerResult memory result;

		result.userNotFirstTradeFlag = getUserNotFirstTradeFlag(user);
		result.alreadySet = affiliatesUserReferrer[user] != address(0);
		result.success = !(result.userNotFirstTradeFlag || result.alreadySet || user == referrer);
		if (result.success) {
			affiliatesUserReferrer[user] = referrer;
			referralsList[referrer].add(user);
			emit SetAffiliatesReferrer(user, referrer);
		} else {
			emit SetAffiliatesReferrerFail(user, referrer, result.alreadySet, result.userNotFirstTradeFlag);
		}
	}

	function getReferralsList(address referrer) external view returns (address[] memory refList) {
		refList = referralsList[referrer].enumerate();
		return refList;
	}

	function getUserNotFirstTradeFlag(address user) public view returns (bool) {
		return userNotFirstTradeFlag[user];
	}

	//REFACTOR move setUserNotFirstTradeFlag to ProtocolSettings?
	function setUserNotFirstTradeFlag(address user) external onlyCallableByLoanPools {
		if (!userNotFirstTradeFlag[user]) {
			userNotFirstTradeFlag[user] = true;
			emit SetUserNotFirstTradeFlag(user);
		}
	}

	function _getAffiliatesTradingFeePercentForSOV() internal view returns (uint256) {
		return affiliateFeePercent;
	}

	// calculate affiliates trading token fee amount
	function _getReferrerTradingFeeForToken(uint256 feeTokenAmount) internal view returns (uint256) {
		return feeTokenAmount.mul(getAffiliateTradingTokenFeePercent()).div(10**20);
	}

	function getAffiliateTradingTokenFeePercent() public view returns (uint256) {
		return affiliateTradingTokenFeePercent;
	}

	function getMinReferralsToPayout() public view returns (uint256) {
		return minReferralsToPayout;
	}

	/**
	 * @dev get the sovToken reward of a trade. The reward is worth x% of the trading fee.
	 * @param feeToken the address of the token in which the trading/borrowig fee was paid
	 * @param feeAmount the height of the fee
	 * */
	function _getSovBonusAmount(address feeToken, uint256 feeAmount) internal view returns (uint256) {
		uint256 rewardAmount;
		address _priceFeeds = priceFeeds;

		//calculate the reward amount, querying the price feed
		(bool success, bytes memory data) =
			_priceFeeds.staticcall(
				abi.encodeWithSelector(
					IPriceFeeds(_priceFeeds).queryReturn.selector,
					feeToken,
					sovTokenAddress, // dest token = SOV
					feeAmount.mul(_getAffiliatesTradingFeePercentForSOV()).div(1e20)
				)
			);
		assembly {
			if eq(success, 1) {
				rewardAmount := mload(add(data, 32))
			}
		}

		return rewardAmount;
	}

	/**
	 * @param tradingFeeTokenBaseAmount total trading fee amount, the base for calculating referrer's fees
	 */
	function payTradingFeeToAffiliatesReferrer(
		address referrer,
		address trader,
		address token,
		uint256 tradingFeeTokenBaseAmount
	) external onlyCallableInternal returns (uint256 referrerBonusSovAmount, uint256 referrerBonusTokenAmount) {
		bool isHeld = referralsList[referrer].length() < getMinReferralsToPayout();
		bool bonusPaymentIsSuccess = true;
		uint256 paidReferrerBonusSovAmount;

		// Process token fee rewards first
		referrerBonusTokenAmount = _getReferrerTradingFeeForToken(tradingFeeTokenBaseAmount);
		if (!affiliatesReferrerTokensList[referrer].contains(token)) affiliatesReferrerTokensList[referrer].add(token);
		affiliatesReferrerBalances[referrer][token] = affiliatesReferrerBalances[referrer][token].add(referrerBonusTokenAmount);

		// Then process SOV rewards
		referrerBonusSovAmount = _getSovBonusAmount(token, tradingFeeTokenBaseAmount);
		uint256 rewardsHeldByProtocol = affiliateRewardsHeld[referrer];

		if (isHeld) {
			// If referrals less than minimum, temp the rewards sov to the storage
			affiliateRewardsHeld[referrer] = rewardsHeldByProtocol.add(referrerBonusSovAmount);
		} else {
			// If referrals >= minimum, directly send all of the remain rewards to locked sov
			// Call depositSOV() in LockedSov contract
			// Set the affiliaterewardsheld = 0
			if (affiliateRewardsHeld[referrer] > 0) {
				affiliateRewardsHeld[referrer] = 0;
			}

			paidReferrerBonusSovAmount = referrerBonusSovAmount.add(rewardsHeldByProtocol);
			IERC20(sovTokenAddress).approve(lockedSOVAddress, paidReferrerBonusSovAmount);

			(bool success, ) =
				lockedSOVAddress.call(abi.encodeWithSignature("depositSOV(address,uint256)", referrer, paidReferrerBonusSovAmount));

			if (!success) {
				bonusPaymentIsSuccess = false;
			}
		}

		if (bonusPaymentIsSuccess) {
			emit PayTradingFeeToAffiliate(
				referrer,
				trader, // trader
				token,
				isHeld,
				tradingFeeTokenBaseAmount,
				referrerBonusTokenAmount,
				referrerBonusSovAmount,
				paidReferrerBonusSovAmount
			);
		} else {
			emit PayTradingFeeToAffiliateFail(
				referrer,
				trader, // trader
				token,
				tradingFeeTokenBaseAmount,
				referrerBonusTokenAmount,
				referrerBonusSovAmount,
				paidReferrerBonusSovAmount
			);
		}

		return (referrerBonusSovAmount, referrerBonusTokenAmount);
	}

	function withdrawAffiliatesReferrerTokenFees(
		address token,
		address receiver,
		uint256 amount
	) public {
		require(receiver != address(0), "Affiliates: cannot withdraw to zero address");
		address referrer = msg.sender;
		uint256 referrerTokenBalance = affiliatesReferrerBalances[referrer][token];
		uint256 withdrawAmount = referrerTokenBalance > amount ? amount : referrerTokenBalance;

		require(withdrawAmount > 0, "Affiliates: cannot withdraw zero amount");

		require(referralsList[referrer].length() >= getMinReferralsToPayout(), "Your referrals has not reached the minimum request");

		uint256 newReferrerTokenBalance = referrerTokenBalance.sub(withdrawAmount);

		if (newReferrerTokenBalance == 0) {
			_removeAffiliatesReferrerToken(referrer, token);
		} else {
			affiliatesReferrerBalances[referrer][token] = newReferrerTokenBalance;
		}

		IERC20(token).safeTransfer(receiver, withdrawAmount);

		emit WithdrawAffiliatesReferrerTokenFees(referrer, receiver, token, withdrawAmount);
	}

	function withdrawAllAffiliatesReferrerTokenFees(address receiver) external {
		require(receiver != address(0), "Affiliates: cannot withdraw to zero address");
		address referrer = msg.sender;

		require(referralsList[referrer].length() >= getMinReferralsToPayout(), "Your referrals has not reached the minimum request");

		(address[] memory tokenAddresses, uint256[] memory tokenBalances) = getAffiliatesReferrerBalances(referrer);
		for (uint256 i; i < tokenAddresses.length; i++) {
			withdrawAffiliatesReferrerTokenFees(tokenAddresses[i], receiver, tokenBalances[i]);
		}
	}

	function _removeAffiliatesReferrerToken(address referrer, address token) internal {
		delete affiliatesReferrerBalances[referrer][token];
		affiliatesReferrerTokensList[referrer].remove(token);
	}

	function getAffiliatesReferrerBalances(address referrer)
		public
		view
		returns (address[] memory referrerTokensList, uint256[] memory referrerTokensBalances)
	{
		referrerTokensList = getAffiliatesReferrerTokensList(referrer);
		referrerTokensBalances = new uint256[](referrerTokensList.length);
		for (uint256 i; i < referrerTokensList.length; i++) {
			referrerTokensBalances[i] = getAffiliatesReferrerTokenBalance(referrer, referrerTokensList[i]);
		}
		return (referrerTokensList, referrerTokensBalances);
	}

	function getAffiliatesReferrerTokensList(address referrer) public view returns (address[] memory tokensList) {
		tokensList = affiliatesReferrerTokensList[referrer].enumerate();
		return tokensList;
	}

	function getAffiliatesReferrerTokenBalance(address referrer, address token) public view returns (uint256) {
		return affiliatesReferrerBalances[referrer][token];
	}

	function getAffiliatesUserReferrer(address user) public view returns (address) {
		return affiliatesUserReferrer[user];
	}

	function getAffiliateRewardsHeld(address referrer) public view returns (uint256) {
		return affiliateRewardsHeld[referrer];
	}
}
