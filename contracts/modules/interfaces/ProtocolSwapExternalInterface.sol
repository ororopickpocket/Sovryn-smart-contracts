/**
 * Copyright 2020, Denis Savelev. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0.
 */

pragma solidity 0.5.17;

interface ProtocolSwapExternalInterface {
	function swapExternal(
		address sourceToken,
		address destToken,
		address receiver,
		address returnToSender,
		uint256 sourceTokenAmount,
		uint256 requiredDestTokenAmount,
		bytes calldata swapData
	) external returns (uint256 destTokenAmountReceived, uint256 sourceTokenAmountUsed);
}
