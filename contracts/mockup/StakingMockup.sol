pragma solidity ^0.5.17;

import "../governance/Staking/Staking.sol";

contract StakingMockup is Staking {
	function balanceOf_MultipliedByTwo(address account) external view returns (uint256) {
		return balanceOf(account) * 2;
	}

	uint96 priorTotalVotingPower;

	function MOCK_priorTotalVotingPower(uint96 _priorTotalVotingPower) public {
		priorTotalVotingPower = _priorTotalVotingPower;
	}

	function getPriorTotalVotingPower(uint32 blockNumber, uint256 time) public view returns (uint96 totalVotingPower) {
		return priorTotalVotingPower != 0 ? priorTotalVotingPower : super.getPriorTotalVotingPower(blockNumber, time);
	}

	uint96 priorWeightedStake;

	function MOCK_priorWeightedStake(uint96 _priorWeightedStake) public {
		priorWeightedStake = _priorWeightedStake;
	}

	function getPriorWeightedStake(
		address account,
		uint256 blockNumber,
		uint256 date
	) public view returns (uint96) {
		return priorWeightedStake != 0 ? priorWeightedStake : super.getPriorWeightedStake(account, blockNumber, date);
	}

	function calculatePriorWeightedStake(
		address account,
		uint256 blockNumber,
		uint256 date
	) public {
		super.getPriorWeightedStake(account, blockNumber, date);
	}

	/**
	 * @dev We need this function to simulate zero delegate checkpoint value.
	 */
	function setDelegateStake(
		address delegatee,
		uint256 lockedTS,
		uint96 value
	) public {
		uint32 nCheckpoints = numDelegateStakingCheckpoints[delegatee][lockedTS];
		uint96 staked = delegateStakingCheckpoints[delegatee][lockedTS][nCheckpoints - 1].stake;
		_writeDelegateCheckpoint(delegatee, lockedTS, nCheckpoints, 0);
	}

	function getCodeHash(address _contract) public view returns (bytes32) {
		return _getCodeHash(_contract);
	}

	function isVestingContract(address _contract) public view returns (bool) {
		bytes32 codeHash = _getCodeHash(_contract);
		return vestingCodeHashes[codeHash];
	}
}
