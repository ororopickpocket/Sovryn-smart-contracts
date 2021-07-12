pragma solidity ^0.5.17;

import "./VestingRegistryStorage.sol";
import "../../proxy/UpgradableProxy.sol";

/**
 * @title Vesting Registry Proxy contract.
 * @dev Vesting Registry contract should be upgradable, use UpgradableProxy.
 * VestingRegistryStorage is deployed with the upgradable functionality
 * by using this contract instead, that inherits from UpgradableProxy
 * the possibility of being enhanced and re-deployed.
 * */
contract VestingRegistryProxy is VestingRegistryStorage, UpgradableProxy {

}
