/**
 * Copyright 2017-2020, bZeroX, LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0.
 */

pragma solidity 0.5.17;

import "../../../core/State.sol";
import "../../../openzeppelin/SafeERC20.sol";
import "../../ISwapsImpl.sol";
import "../../../feeds/IPriceFeeds.sol";
import "../../../testhelpers/TestToken.sol";

/**
 * @title Swaps Implementation Local contract.
 *
 * @notice This contract code comes from bZx. bZx is a protocol for tokenized
 * margin trading and lending https://bzx.network similar to the dYdX protocol.
 *
 * This contract contains the implementation of swap process and rate calculations.
 * */
contract SwapsImplLocal is State, ISwapsImpl {
	using SafeERC20 for IERC20;

	/**
	 * @notice Swap two tokens.
	 *
	 * @param sourceTokenAddress The address of the source tokens.
	 * @param destTokenAddress The address of the destiny tokens.
	 *
	 * @return destTokenAmountReceived The amount of destiny tokens sent.
	 * @return sourceTokenAmountUsed The amount of source tokens spent.
	 * */
	function internalSwap(
		address sourceTokenAddress,
		address destTokenAddress,
		//address, /*receiverAddress*/
		address returnToSenderAddress,
		uint256 minSourceTokenAmount,
		uint256 maxSourceTokenAmount,
		uint256 requiredDestTokenAmount
	) public returns (uint256 destTokenAmountReceived, uint256 sourceTokenAmountUsed) {
		require(sourceTokenAddress != destTokenAddress, "source == dest");

		(uint256 tradeRate, uint256 precision) = IPriceFeeds(priceFeeds).queryRate(sourceTokenAddress, destTokenAddress);

		if (requiredDestTokenAmount == 0) {
			sourceTokenAmountUsed = minSourceTokenAmount;
			destTokenAmountReceived = minSourceTokenAmount.mul(tradeRate).div(precision);
		} else {
			destTokenAmountReceived = requiredDestTokenAmount;
			sourceTokenAmountUsed = requiredDestTokenAmount.mul(precision).div(tradeRate);
			require(sourceTokenAmountUsed <= minSourceTokenAmount, "destAmount too great");
		}

		TestToken(sourceTokenAddress).burn(address(this), sourceTokenAmountUsed);
		TestToken(destTokenAddress).mint(address(this), destTokenAmountReceived);

		if (returnToSenderAddress != address(this)) {
			if (sourceTokenAmountUsed < maxSourceTokenAmount) {
				/// Send unused source token back.
				IERC20(sourceTokenAddress).safeTransfer(returnToSenderAddress, maxSourceTokenAmount - sourceTokenAmountUsed);
			}
		}
	}

	/**
	 * @notice Calculate the expected price rate of swapping a given amount
	 *   of tokens.
	 *
	 * @param sourceTokenAddress The address of the source tokens.
	 * @param destTokenAddress The address of the destiny tokens.
	 * @param sourceTokenAmount The amount of source tokens.
	 * @param unused Fourth parameter ignored.
	 *
	 * @return precision The expected price rate.
	 * */
	function internalExpectedRate(
		address sourceTokenAddress,
		address destTokenAddress,
		uint256 sourceTokenAmount,
		address unused
	) public view returns (uint256) {
		(uint256 sourceToDestRate, uint256 sourceToDestPrecision) = IPriceFeeds(priceFeeds).queryRate(sourceTokenAddress, destTokenAddress);

		return sourceTokenAmount.mul(sourceToDestRate).div(sourceToDestPrecision);
	}

	/**
	 * @notice Calculate the expected return of swapping a given amount
	 *   of tokens.
	 *
	 * @param sourceTokenAddress The address of the source tokens.
	 * @param destTokenAddress The address of the destiny tokens.
	 * @param sourceTokenAmount The amount of source tokens.
	 * @param unused Fourth parameter ignored.
	 *
	 * @return precision The expected return.
	 * */
	function internalExpectedReturn(
		address sourceTokenAddress,
		address destTokenAddress,
		uint256 sourceTokenAmount,
		address unused
	) public view returns (uint256) {
		(uint256 sourceToDestRate, uint256 sourceToDestPrecision) = IPriceFeeds(priceFeeds).queryRate(sourceTokenAddress, destTokenAddress);

		return sourceTokenAmount.mul(sourceToDestRate).div(sourceToDestPrecision);
	}
}
