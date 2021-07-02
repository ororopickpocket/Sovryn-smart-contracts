pragma solidity ^0.5.17;
pragma experimental ABIEncoderV2;

import "../governance/Vesting/VestingLogic.sol";

contract VestingLogicMockup is VestingLogic {
	/**
	 * @dev we had a bug in a loop: "i < endDate" instead of "i <= endDate"
	 */
	function delegate(address _delegatee) public onlyTokenOwner {
		require(_delegatee != address(0), "delegatee address invalid");

		/// @dev Withdraw for each unlocked position.
		/// @dev Don't change FOUR_WEEKS to TWO_WEEKS, a lot of vestings already deployed with FOUR_WEEKS
		///		workaround found, but it doesn't work with TWO_WEEKS
		for (uint256 i = startDate + cliff; i < endDate; i += FOUR_WEEKS) {
			staking.delegate(_delegatee, i);
		}
		emit VotesDelegated(msg.sender, _delegatee);
	}
}
