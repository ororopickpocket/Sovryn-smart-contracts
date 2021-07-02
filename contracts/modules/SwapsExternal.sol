/**
 * Copyright 2017-2020, bZeroX, LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0.
 */

pragma solidity 0.5.17;
pragma experimental ABIEncoderV2;

import "../core/State.sol";
import "../mixins/VaultController.sol";
import "../swaps/SwapsUser.sol";
import "../swaps/ISwapsImpl.sol";

/**
 * @title Swaps External contract.
 *
 * @notice This contract code comes from bZx. bZx is a protocol for tokenized
 * margin trading and lending https://bzx.network similar to the dYdX protocol.
 *
 * This contract contains functions to calculate and execute swaps.
 * */
contract SwapsExternal is VaultController, SwapsUser {
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
	 * @notice Set function selectors on target contract.
	 *
	 * @param target The address of the target contract.
	 * */
	function initialize(address target) external onlyOwner {
		_setTarget(this.swapExternal.selector, target);
		_setTarget(this.getSwapExpectedReturn.selector, target);
		_setTarget(this.checkPriceDivergence.selector, target);
	}

	/**
	 * @notice Perform a swap w/ tokens or rBTC as source currency.
	 *
	 * @dev External wrapper that calls SwapsUser::_swapsCall
	 * after turning potential incoming rBTC into wrBTC tokens.
	 *
	 * @param sourceToken The address of the source token instance.
	 * @param destToken The address of the destiny token instance.
	 * @param receiver The address of the recipient account.
	 * @param returnToSender The address of the sender account.
	 * @param sourceTokenAmount The amount of source tokens.
	 * @param requiredDestTokenAmount The amount of required destiny tokens.
	 * @param swapData Additional swap data (not in use yet).
	 *
	 * @return destTokenAmountReceived The amount of destiny tokens sent.
	 * @return sourceTokenAmountUsed The amount of source tokens spent.
	 * */
	function swapExternal(
		address sourceToken,
		address destToken,
		address receiver,
		address returnToSender,
		uint256 sourceTokenAmount,
		uint256 requiredDestTokenAmount,
		uint256 minReturn,
		bytes memory swapData
	) public payable nonReentrant returns (uint256 destTokenAmountReceived, uint256 sourceTokenAmountUsed) {
		require(sourceTokenAmount != 0, "sourceTokenAmount == 0");
		checkPriceDivergence(sourceToken, destToken, sourceTokenAmount, minReturn);

		/// @dev Get payed value, be it rBTC or tokenized.
		if (msg.value != 0) {
			if (sourceToken == address(0)) {
				sourceToken = address(wrbtcToken);
			}
			require(sourceToken == address(wrbtcToken), "sourceToken mismatch");
			require(msg.value == sourceTokenAmount, "sourceTokenAmount mismatch");

			/// @dev Update wrBTC balance for this contract.
			wrbtcToken.deposit.value(sourceTokenAmount)();
		} else {
			/// @dev Transfer tokens from sender to this contract.
			IERC20 sourceTokenContract = IERC20(sourceToken);

			uint256 balanceBefore = sourceTokenContract.balanceOf(address(this));

			IERC20(sourceToken).safeTransferFrom(msg.sender, address(this), sourceTokenAmount);

			// explicit balance check so that we can support deflationary tokens
			sourceTokenAmount = sourceTokenContract.balanceOf(address(this)).sub(balanceBefore);
		}

		/// @dev Perform the swap w/ tokens.
		(destTokenAmountReceived, sourceTokenAmountUsed) = _swapsCall(
			[
				sourceToken,
				destToken,
				receiver,
				returnToSender,
				msg.sender /// user
			],
			[
				sourceTokenAmount, /// minSourceTokenAmount
				sourceTokenAmount, /// maxSourceTokenAmount
				requiredDestTokenAmount
			],
			0, /// loanId (not tied to a specific loan)
			false, /// bypassFee
			swapData
		);

		emit ExternalSwap(
			msg.sender, /// user
			sourceToken,
			destToken,
			sourceTokenAmountUsed,
			destTokenAmountReceived
		);
	}

	/**
	 * @notice Get the swap expected return value.
	 *
	 * @dev External wrapper that calls SwapsUser::_swapsExpectedReturn
	 *
	 * @param sourceToken The address of the source token instance.
	 * @param destToken The address of the destiny token instance.
	 * @param sourceTokenAmount The amount of source tokens.
	 *
	 * @return The expected return value.
	 * */
	function getSwapExpectedReturn(
		address sourceToken,
		address destToken,
		uint256 sourceTokenAmount
	) external view returns (uint256) {
		return _swapsExpectedReturn(sourceToken, destToken, sourceTokenAmount);
	}

	function checkPriceDivergence(
		address sourceToken,
		address destToken,
		uint256 sourceTokenAmount,
		uint256 minReturn
	) public view {
		uint256 destTokenAmount = _swapsExpectedReturn(sourceToken, destToken, sourceTokenAmount);
		require(destTokenAmount >= minReturn, "destTokenAmountReceived too low");
	}
}
