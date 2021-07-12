pragma solidity ^0.5.17;

/**
 * @title Interface for upgradable Vesting Registry contract.
 * @dev Interfaces are used to cast a contract address into a callable instance.
 */
interface IVestingRegistry {
	function getVesting(address _tokenOwner) external view returns (address);

	function getTeamVesting(address _tokenOwner) external view returns (address);
}
