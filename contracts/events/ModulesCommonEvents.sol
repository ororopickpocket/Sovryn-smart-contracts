pragma solidity 0.5.17;

/**
 * @title The common events for all modules
 * @notice This contract contains the events which will be used by all modules
 **/

contract ModulesCommonEvents {
	event ProtocolModuleContractReplaced(
		address indexed prevModuleContractAddress,
		address indexed newModuleContractAddress,
		bytes32 indexed module
	);
}
