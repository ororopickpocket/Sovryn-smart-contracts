/**
 * Copyright 2017-2021, bZeroX, LLC <https://bzx.network/>. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0.
 */

pragma solidity 0.5.17;

import "../core/State.sol";
import "../feeds/IPriceFeeds.sol";
import "../events/SwapsEvents.sol";
import "../mixins/FeesHelper.sol";
import "./ISwapsImpl.sol";

/**
 * @title Perform token swaps for loans and trades.
 * */
contract SwapsUser is State, SwapsEvents, FeesHelper {
	/**
	 * @notice Internal loan swap.
	 *
	 * @param loanId The ID of the loan.
	 * @param sourceToken The address of the source tokens.
	 * @param destToken The address of destiny tokens.
	 * @param user The user address.
	 * @param minSourceTokenAmount The minimum amount of source tokens to swap.
	 * @param maxSourceTokenAmount The maximum amount of source tokens to swap.
	 * @param requiredDestTokenAmount The required amount of destination tokens.
	 * @param bypassFee To bypass or not the fee.
	 * @param loanDataBytes The payload for the call. These loan DataBytes are
	 *   additional loan data (not in use for token swaps).
	 *
	 * @return destTokenAmountReceived
	 * @return sourceTokenAmountUsed
	 * @return sourceToDestSwapRate
	 * */
	function _loanSwap(
		bytes32 loanId,
		address sourceToken,
		address destToken,
		address user,
		uint256 minSourceTokenAmount,
		uint256 maxSourceTokenAmount,
		uint256 requiredDestTokenAmount,
		bool bypassFee,
		bytes memory loanDataBytes
	)
		internal
		returns (
			uint256 destTokenAmountReceived,
			uint256 sourceTokenAmountUsed,
			uint256 sourceToDestSwapRate
		)
	{
		(destTokenAmountReceived, sourceTokenAmountUsed) = _swapsCall(
			[
				sourceToken,
				destToken,
				address(this), // receiver
				address(this), // returnToSender
				user
			],
			[minSourceTokenAmount, maxSourceTokenAmount, requiredDestTokenAmount],
			loanId,
			bypassFee,
			loanDataBytes
		);

		/// Will revert if swap size too large.
		_checkSwapSize(sourceToken, sourceTokenAmountUsed);

		/// Will revert if disagreement found.
		sourceToDestSwapRate = IPriceFeeds(priceFeeds).checkPriceDisagreement(
			sourceToken,
			destToken,
			sourceTokenAmountUsed,
			destTokenAmountReceived,
			maxDisagreement
		);

		emit LoanSwap(loanId, sourceToken, destToken, user, sourceTokenAmountUsed, destTokenAmountReceived);
	}

	/**
	 * @notice Calculate amount of source and destiny tokens.
	 *
	 * @dev Wrapper for _swapsCall_internal function.
	 *
	 * @param addrs The array of addresses.
	 * @param vals The array of values.
	 * @param loanId The Id of the associated loan.
	 * @param miscBool True/false to bypassFee.
	 * @param loanDataBytes Additional loan data (not in use yet).
	 *
	 * @return destTokenAmountReceived The amount of destiny tokens received.
	 * @return sourceTokenAmountUsed The amount of source tokens used.
	 * */
	function _swapsCall(
		address[5] memory addrs,
		uint256[3] memory vals,
		bytes32 loanId,
		bool miscBool, /// bypassFee
		bytes memory loanDataBytes
	) internal returns (uint256, uint256) {
		/// addrs[0]: sourceToken
		/// addrs[1]: destToken
		/// addrs[2]: receiver
		/// addrs[3]: returnToSender
		/// addrs[4]: user
		/// vals[0]:  minSourceTokenAmount
		/// vals[1]:  maxSourceTokenAmount
		/// vals[2]:  requiredDestTokenAmount

		require(vals[0] != 0 || vals[1] != 0, "min or max source token amount needs to be set");

		if (vals[1] == 0) {
			vals[1] = vals[0];
		}
		require(vals[0] <= vals[1], "sourceAmount larger than max");

		uint256 destTokenAmountReceived;
		uint256 sourceTokenAmountUsed;

		uint256 tradingFee;
		if (!miscBool) {
			/// bypassFee
			if (vals[2] == 0) {
				/// condition: vals[0] will always be used as sourceAmount

				tradingFee = _getTradingFee(vals[0]);
				if (tradingFee != 0) {
					_payTradingFee(
						addrs[4], /// user
						loanId,
						addrs[0], /// sourceToken (feeToken)
						addrs[1], /// pairToken (used to check if there is any special rebates or not) -- to pay fee reward
						tradingFee
					);

					vals[0] = vals[0].sub(tradingFee);
				}
			} else {
				/// Condition: unknown sourceAmount will be used.

				tradingFee = _getTradingFee(vals[2]);

				if (tradingFee != 0) {
					vals[2] = vals[2].add(tradingFee);
				}
			}
		}

		require(loanDataBytes.length == 0, "invalid state");

		(destTokenAmountReceived, sourceTokenAmountUsed) = _swapsCall_internal(addrs, vals);

		if (vals[2] == 0) {
			/// There's no minimum destTokenAmount, but all of vals[0]
			/// (minSourceTokenAmount) must be spent.
			require(sourceTokenAmountUsed == vals[0], "swap too large to fill");

			if (tradingFee != 0) {
				sourceTokenAmountUsed = sourceTokenAmountUsed.add(tradingFee);
			}
		} else {
			/// There's a minimum destTokenAmount required, but
			/// sourceTokenAmountUsed won't be greater
			/// than vals[1] (maxSourceTokenAmount)
			require(sourceTokenAmountUsed <= vals[1], "swap fill too large");
			require(destTokenAmountReceived >= vals[2], "insufficient swap liquidity");

			if (tradingFee != 0) {
				_payTradingFee(
					addrs[4], /// user
					loanId, /// loanId,
					addrs[1], /// destToken (feeToken)
					addrs[0], /// pairToken (used to check if there is any special rebates or not) -- to pay fee reward
					tradingFee
				);

				destTokenAmountReceived = destTokenAmountReceived.sub(tradingFee);
			}
		}

		return (destTokenAmountReceived, sourceTokenAmountUsed);
	}

	/**
	 * @notice Calculate amount of source and destiny tokens.
	 *
	 * @dev Calls swapsImpl::internalSwap
	 *
	 * @param addrs The array of addresses.
	 * @param vals The array of values.
	 *
	 * @return destTokenAmountReceived The amount of destiny tokens received.
	 * @return sourceTokenAmountUsed The amount of source tokens used.
	 * */
	function _swapsCall_internal(address[5] memory addrs, uint256[3] memory vals)
		internal
		returns (uint256 destTokenAmountReceived, uint256 sourceTokenAmountUsed)
	{
		bytes memory data =
			abi.encodeWithSelector(
				ISwapsImpl(swapsImpl).internalSwap.selector,
				addrs[0], /// sourceToken
				addrs[1], /// destToken
				addrs[2], /// receiverAddress
				addrs[3], /// returnToSenderAddress
				vals[0], /// minSourceTokenAmount
				vals[1], /// maxSourceTokenAmount
				vals[2] /// requiredDestTokenAmount
			);

		bool success;
		(success, data) = swapsImpl.delegatecall(data);
		require(success, "swap failed");

		assembly {
			destTokenAmountReceived := mload(add(data, 32))
			sourceTokenAmountUsed := mload(add(data, 64))
		}
	}

	/**
	 * @notice Calculate expected amount of destiny tokens.
	 *
	 * @dev Calls swapsImpl::internalExpectedReturn
	 *
	 * @param sourceToken The address of the source tokens.
	 * @param destToken The address of the destiny tokens.
	 * @param sourceTokenAmount The amount of the source tokens.
	 *
	 * @param destTokenAmount The amount of destiny tokens.
	 * */
	function _swapsExpectedReturn(
		address sourceToken,
		address destToken,
		uint256 sourceTokenAmount
	) internal view returns (uint256 destTokenAmount) {
		destTokenAmount = ISwapsImpl(swapsImpl).internalExpectedReturn(
			sourceToken,
			destToken,
			sourceTokenAmount,
			sovrynSwapContractRegistryAddress
		);
	}

	/**
	 * @notice Verify that the amount of tokens are under the swap limit.
	 *
	 * @dev Calls priceFeeds::amountInEth
	 *
	 * @param tokenAddress The address of the token to calculate price.
	 * @param amount The amount of tokens to calculate price.
	 * */
	function _checkSwapSize(address tokenAddress, uint256 amount) internal view {
		uint256 _maxSwapSize = maxSwapSize;
		if (_maxSwapSize != 0) {
			uint256 amountInEth;
			if (tokenAddress == address(wrbtcToken)) {
				amountInEth = amount;
			} else {
				amountInEth = IPriceFeeds(priceFeeds).amountInEth(tokenAddress, amount);
			}
			require(amountInEth <= _maxSwapSize, "swap too large");
		}
	}
}
