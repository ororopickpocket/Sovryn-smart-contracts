pragma solidity ^0.5.17;

import "../openzeppelin/SafeMath.sol";
import "../interfaces/IERC20.sol";

/**
 *  @title An interface for the Locked SOV Contract.
 *  @author Franklin Richards - powerhousefrank@protonmail.com
 *  @dev This is not a complete interface of the Locked SOV Contract.
 */
contract LockedSOVFailedMockup {
	using SafeMath for uint256;

	/* Storage */

	/// @notice The SOV token contract.
	IERC20 public SOV;

	/// @notice The user balances.
	mapping(address => uint256) lockedBalances;
	/// @notice The user balances.
	mapping(address => bool) isAdmin;

	/* Events */

	/// @notice Emitted when a new Admin is added to the admin list.
	/// @param _initiator The address which initiated this event to be emitted.
	/// @param _newAdmin The address of the new admin.
	event AdminAdded(address indexed _initiator, address indexed _newAdmin);

	/// @notice Emitted when an admin is removed from the admin list.
	/// @param _initiator The address which initiated this event to be emitted.
	/// @param _removedAdmin The address of the removed admin.
	event AdminRemoved(address indexed _initiator, address indexed _removedAdmin);

	/* Modifiers */

	modifier onlyAdmin {
		require(isAdmin[msg.sender], "Only admin can call this.");
		_;
	}

	/* Functions */

	/**
	 * @notice Setup the required parameters.
	 * @param _SOV The SOV token address.
	 * @param _admins The list of admins to be added.
	 */
	constructor(address _SOV, address[] memory _admins) public {
		require(_SOV != address(0), "Invalid SOV Address.");
		SOV = IERC20(_SOV);
		for (uint256 index = 0; index < _admins.length; index++) {
			isAdmin[_admins[index]] = true;
		}
	}

	/**
	 * @notice The function to add a new admin.
	 * @param _newAdmin The address of the new admin.
	 */
	function addAdmin(address _newAdmin) public onlyAdmin {
		require(_newAdmin != address(0), "Invalid Address");
		require(!isAdmin[_newAdmin], "Address is already admin");
		isAdmin[_newAdmin] = true;

		emit AdminAdded(msg.sender, _newAdmin);
	}

	/**
	 * @notice The function to remove an admin.
	 * @param _adminToRemove The address of the admin which should be removed.
	 */
	function removeAdmin(address _adminToRemove) public onlyAdmin {
		require(isAdmin[_adminToRemove], "Address is not an admin");
		isAdmin[_adminToRemove] = false;

		emit AdminRemoved(msg.sender, _adminToRemove);
	}

	/**
	 * @notice Adds SOV to the locked balance of a user.
	 * @param _userAddress The user whose locked balance has to be updated with _sovAmount.
	 * @param _sovAmount The amount of SOV to be added to the locked balance.
	 */
	function depositSOV(address _userAddress, uint256 _sovAmount) external {
		revert("For testing purposes");
		bool txStatus = SOV.transferFrom(msg.sender, address(this), _sovAmount);
		require(txStatus, "Token transfer was not successful. Check receiver address.");

		lockedBalances[_userAddress] = lockedBalances[_userAddress].add(_sovAmount);
	}

	/**
	 * @notice The function to get the locked balance of a user.
	 * @param _addr The address of the user to check the locked balance.
	 * @return _balance The locked balance of the address `_addr`.
	 */
	function getLockedBalance(address _addr) public view returns (uint256 _balance) {
		return lockedBalances[_addr];
	}
}
