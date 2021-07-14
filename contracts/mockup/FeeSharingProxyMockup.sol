pragma solidity ^0.5.17;

import "../governance/FeeSharingProxy.sol";

contract FeeSharingProxyMockup is FeeSharingProxy {
	struct TestData {
		address loanPoolToken;
		uint32 maxCheckpoints;
		address receiver;
	}

	TestData public testData;

	constructor(IProtocol _protocol, IStaking _staking, address wRBTCAddress) public FeeSharingProxy(_protocol, _staking, wRBTCAddress) {}

	function withdraw(
		address _loanPoolToken,
		uint32 _maxCheckpoints,
		address _receiver
	) public {
		testData = TestData(_loanPoolToken, _maxCheckpoints, _receiver);
	}

	function trueWithdraw(
		address _loanPoolToken,
		uint32 _maxCheckpoints,
		address _receiver
	) public {
		super.withdraw(_loanPoolToken, _maxCheckpoints, _receiver);
	}

	function addCheckPoint(address loanPoolToken, uint256 poolTokenAmount) public {
		uint96 amount96 = safe96(poolTokenAmount, "FeeSharingProxy::withdrawFees: pool token amount exceeds 96 bits");
		unprocessedAmount[loanPoolToken] = add96(
			unprocessedAmount[loanPoolToken],
			amount96,
			"FeeSharingProxy::withdrawFees: unprocessedAmount exceeds 96 bits"
		);
		_addCheckpoint(loanPoolToken);
	}
}
