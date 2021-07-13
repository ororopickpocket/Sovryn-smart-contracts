/**
 * Copyright 2017-2021, bZeroX, LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0.
 */

pragma solidity 0.5.17;

/**
 * @title The Fees Events contract.
 * @notice This contract code comes from bZx. bZx is a protocol for tokenized
 * margin trading and lending https://bzx.network similar to the dYdX protocol.
 *
 * This contract contains the events for fee payments.
 * */
contract FeesEvents {
	event PayLendingFee(address indexed payer, address indexed token, uint256 amount);

	event PayTradingFee(address indexed payer, address indexed token, bytes32 indexed loanId, uint256 amount);

	event PayBorrowingFee(address indexed payer, address indexed token, bytes32 indexed loanId, uint256 amount);

	event EarnReward(address indexed receiver, address indexed token, bytes32 indexed loanId, uint256 feeRebatePercent, uint256 amount);

	event EarnRewardFail(address indexed receiver, address indexed token, bytes32 indexed loanId, uint256 feeRebatePercent, uint256 amount);
}
