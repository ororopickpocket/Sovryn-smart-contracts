/**
 * Copyright 2017-2021, bZeroX, LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0.
 */

pragma solidity 0.5.17;

/**
 * @title The Protocol Settings Events contract.
 * @notice This contract code comes from bZx. bZx is a protocol for tokenized
 * margin trading and lending https://bzx.network similar to the dYdX protocol.
 *
 * This contract contains the events for protocol settings operations.
 * */
contract ProtocolSettingsEvents {
	event SetPriceFeedContract(address indexed sender, address oldValue, address newValue);

	event SetSwapsImplContract(address indexed sender, address oldValue, address newValue);

	event SetLoanPool(address indexed sender, address indexed loanPool, address indexed underlying);

	event SetSupportedTokens(address indexed sender, address indexed token, bool isActive);

	event SetLendingFeePercent(address indexed sender, uint256 oldValue, uint256 newValue);

	event SetTradingFeePercent(address indexed sender, uint256 oldValue, uint256 newValue);

	event SetBorrowingFeePercent(address indexed sender, uint256 oldValue, uint256 newValue);

	event SetAffiliateFeePercent(address indexed sender, uint256 oldValue, uint256 newValue);

	event SetAffiliateTradingTokenFeePercent(address indexed sender, uint256 oldValue, uint256 newValue);

	event SetLiquidationIncentivePercent(address indexed sender, uint256 oldValue, uint256 newValue);

	event SetMaxSwapSize(address indexed sender, uint256 oldValue, uint256 newValue);

	event SetFeesController(address indexed sender, address indexed oldController, address indexed newController);

	event SetWrbtcToken(address indexed sender, address indexed oldWethToken, address indexed newWethToken);

	event SetSovrynSwapContractRegistryAddress(
		address indexed sender,
		address indexed oldSovrynSwapContractRegistryAddress,
		address indexed newSovrynSwapContractRegistryAddress
	);

	event SetProtocolTokenAddress(address indexed sender, address indexed oldProtocolToken, address indexed newProtocolToken);

	event WithdrawFees(
		address indexed sender,
		address indexed token,
		address indexed receiver,
		uint256 lendingAmount,
		uint256 tradingAmount,
		uint256 borrowingAmount,
		uint256 wRBTCConverted
	);

	event WithdrawLendingFees(address indexed sender, address indexed token, address indexed receiver, uint256 amount);

	event WithdrawTradingFees(address indexed sender, address indexed token, address indexed receiver, uint256 amount);

	event WithdrawBorrowingFees(address indexed sender, address indexed token, address indexed receiver, uint256 amount);

	event SetRolloverBaseReward(address indexed sender, uint256 oldValue, uint256 newValue);

	event SetRebatePercent(address indexed sender, uint256 oldRebatePercent, uint256 newRebatePercent);

	event SetProtocolAddress(address indexed sender, address indexed oldProtocol, address indexed newProtocol);

	event SetMinReferralsToPayoutAffiliates(address indexed sender, uint256 oldMinReferrals, uint256 newMinReferrals);

	event SetSOVTokenAddress(address indexed sender, address indexed oldTokenAddress, address indexed newTokenAddress);

	event SetLockedSOVAddress(address indexed sender, address indexed oldAddress, address indexed newAddress);
}
