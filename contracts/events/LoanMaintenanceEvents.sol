pragma solidity 0.5.17;

import "./ModulesCommonEvents.sol";

/**
 * @title The Loan Maintenance Events contract.
 * @notice This contract code comes from bZx. bZx is a protocol for tokenized
 * margin trading and lending https://bzx.network similar to the dYdX protocol.
 *
 * This contract contains the events for loan maintenance operations.
 * */
contract LoanMaintenanceEvents is ModulesCommonEvents {
	event DepositCollateral(bytes32 loanId, uint256 depositAmount, uint256 rate);
}
