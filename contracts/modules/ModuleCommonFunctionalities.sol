pragma solidity 0.5.17;

import "../core/State.sol";

contract ModuleCommonFunctionalities is State {
	modifier whenNotPaused() {
		require(!pause, "Paused");
		_;
	}
}
