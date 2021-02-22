pragma solidity 0.5.17;

import "../modules/Affiliates.sol";

contract MockAffiliates is Affiliates {
	function getAffiliatesUserReferrer(address user) public view returns (address) {
		return affiliatesUserReferrer[user]; // REFACTOR: will be useful if affiliatesUserReferrer visibillity is not public
	}

	function initialize(address target) external onlyOwner {
		_setTarget(this.getAffiliatesUserReferrer.selector, target);
	}
}
