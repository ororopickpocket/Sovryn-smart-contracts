/**
 * Copyright 2017-2021, bZeroX, LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0.
 */

pragma solidity 0.5.17;

import "./ModulesCommonEvents.sol";

/**
 * @title The Swaps Events contract.
 * @notice This contract code comes from bZx. bZx is a protocol for tokenized
 * margin trading and lending https://bzx.network similar to the dYdX protocol.
 *
 * This contract contains the events for swap operations.
 * */
contract SwapsEvents is ModulesCommonEvents {
	event LoanSwap(
		bytes32 indexed loanId,
		address indexed sourceToken,
		address indexed destToken,
		address borrower,
		uint256 sourceAmount,
		uint256 destAmount
	);

	event ExternalSwap(
		address indexed user,
		address indexed sourceToken,
		address indexed destToken,
		uint256 sourceAmount,
		uint256 destAmount
	);
}
