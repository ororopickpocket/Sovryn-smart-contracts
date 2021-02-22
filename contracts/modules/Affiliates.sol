/**
 * Copyright 2017-2020, Sovryn, All Rights Reserved.
 * Licensed under the Apache License, Version 2.0.
 */

pragma solidity 0.5.17;
pragma experimental ABIEncoderV2;

import "../core/State.sol";
//import "../events/LoanSettingsEvents.sol";
import "../mixins/EnumerableBytes32Set.sol";
//import "../mixins/VaultController.sol";
import "../openzeppelin/SafeERC20.sol";
import "../events/AffiliatesEvents.sol";

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
		_setTarget(this.setUserNotFirstTradeFlag.selector, target);
		_setTarget(this.getAffiliatesReferrerBalances.selector, target);
		_setTarget(this.getAffiliatesReferrerTokenBalance.selector, target);
		_setTarget(this.payTradingFeeToAffiliatesReferrer.selector, target);
		_setTarget(this.getAffiliatesReferrerTokensList.selector, target);
		_setTarget(this.withdrawAffiliatesReferrerTokenFees.selector, target);
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
		result.alreadySet = affiliatesUserReferrer[user] != address(0) ? true : false;
		result.success = !(result.userNotFirstTradeFlag || result.alreadySet || user == referrer);
		if (result.success) {
			affiliatesUserReferrer[user] = referrer;
			emit SetAffiliatesReferrer(user, referrer);
		} else {
			emit SetAffiliatesReferrerFail(user, referrer, result.alreadySet, result.userNotFirstTradeFlag);
		}
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

	//AUDIT Do we need to allow an owner to nullify a referrer for some reason?
	/*
    function affiliatesRemoveUserReferrer(address user, address referrer) external onlyOwner {
        if(referrer != address(0) && getUserNotFirstTradeFlag[user]) {
            delete affiliatesUserReferrer[user];
            //TODO: event with the reason for removing referrer
        }
    }
    */

	// calculate affiliates trading fee amount
	function _getReferrerTradingFee(uint256 feeTokenAmount) internal view returns (uint256) {
		return feeTokenAmount.mul(_getAffiliatesTradingFeePercent()).div(10**20);
	}

	function _getAffiliatesTradingFeePercent() internal view returns (uint256) {
		return affiliateFeePercent;
	}

	/**
	 * @param tradingFeeTokenBaseAmount total trading fee amount, the base for calculating referrer's fees
	 */
	function payTradingFeeToAffiliatesReferrer(
		address referrer,
		address token,
		uint256 tradingFeeTokenBaseAmount
	) external onlyCallableInternal returns (uint256 referrerTradingFee) {
		if (tradingFeeTokenBaseAmount > 0) {
			referrerTradingFee = _getReferrerTradingFee(tradingFeeTokenBaseAmount);
			if (!affiliatesReferrerTokensList[referrer].contains(token)) affiliatesReferrerTokensList[referrer].add(token);
			affiliatesReferrerBalances[referrer][token] = affiliatesReferrerBalances[referrer][token].add(referrerTradingFee);
		}

		emit PayTradingFeeToAffiliate(referrer, token, referrerTradingFee);

		return referrerTradingFee;
	}

	function withdrawAffiliatesReferrerTokenFees(
		address token,
		address receiver,
		uint256 amount
	) external {
		require(receiver != address(0), "Affiliates: cannot withdraw to zero address");
		address referrer = msg.sender;
		uint256 referrerTokenBalance = affiliatesReferrerBalances[referrer][token];
		uint256 withdrawAmount = referrerTokenBalance > amount ? amount : referrerTokenBalance;

		require(withdrawAmount > 0, "Affiliates: cannot withdraw zero amount");

		if (referrerTokenBalance > 0) {
			uint256 newReferrerTokenBalance = referrerTokenBalance.sub(withdrawAmount);

			if (newReferrerTokenBalance == 0) {
				_removeAffiliatesReferrerToken(referrer, token);
			} else {
				affiliatesReferrerBalances[referrer][token] = newReferrerTokenBalance;
			}

			IERC20(token).safeTransfer(receiver, withdrawAmount);

			emit WithdrawAffiliatesReferrerTokenFees(referrer, receiver, token, withdrawAmount);
		}
	}

	function _removeAffiliatesReferrerToken(address referrer, address token) internal {
		delete affiliatesReferrerBalances[referrer][token];
		affiliatesReferrerTokensList[referrer].remove(token);
	}

	function getAffiliatesReferrerBalances(address referrer)
		external
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
}
