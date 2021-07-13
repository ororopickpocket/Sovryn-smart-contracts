/**
 * Copyright 2017-2021, bZeroX, LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0.
 */

pragma solidity 0.5.17;

import "./ModulesCommonEvents.sol";

/**
 * @title The Loan Settings Events contract.
 * @notice This contract code comes from bZx. bZx is a protocol for tokenized
 * margin trading and lending https://bzx.network similar to the dYdX protocol.
 *
 * This contract contains the events for loan settings operations.
 * */
contract LoanSettingsEvents is ModulesCommonEvents {
	event LoanParamsSetup(
		bytes32 indexed id,
		address owner,
		address indexed loanToken,
		address indexed collateralToken,
		uint256 minInitialMargin,
		uint256 maintenanceMargin,
		uint256 maxLoanTerm
	);
	event LoanParamsIdSetup(bytes32 indexed id, address indexed owner);

	event LoanParamsDisabled(
		bytes32 indexed id,
		address owner,
		address indexed loanToken,
		address indexed collateralToken,
		uint256 minInitialMargin,
		uint256 maintenanceMargin,
		uint256 maxLoanTerm
	);
	event LoanParamsIdDisabled(bytes32 indexed id, address indexed owner);
}
