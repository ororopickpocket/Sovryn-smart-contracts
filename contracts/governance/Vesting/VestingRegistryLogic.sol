pragma solidity ^0.5.17;
pragma experimental ABIEncoderV2;

import "../../interfaces/IERC20.sol";
import "../IFeeSharingProxy.sol";
import "./IVesting.sol";
import "./ITeamVesting.sol";
import "./VestingRegistryStorage.sol";
import "../../openzeppelin/Initializable.sol";

contract VestingRegistryLogic is VestingRegistryStorage, Initializable {
	event SOVTransferred(address indexed receiver, uint256 amount);
	event VestingCreated(
		address indexed tokenOwner,
		address vesting,
		uint256 cliff,
		uint256 duration,
		uint256 amount,
		uint256 vestingCreationType
	);
	event TeamVestingCreated(
		address indexed tokenOwner,
		address vesting,
		uint256 cliff,
		uint256 duration,
		uint256 amount,
		uint256 vestingCreationType
	);
	event TokensStaked(address indexed vesting, uint256 amount);

	/**
	 * @notice Replace constructor with initialize function for Upgradable Contracts
	 * This function will be called only once by the owner
	 * */
	function initialize(
		address _vestingFactory,
		address _SOV,
		address _staking,
		address _feeSharingProxy,
		address _vestingOwner,
		address _lockedSOV,
		address[] memory _vestingRegistries
	) public onlyOwner initializer {
		require(_SOV != address(0), "SOV address invalid");
		require(_staking != address(0), "staking address invalid");
		require(_feeSharingProxy != address(0), "feeSharingProxy address invalid");
		require(_vestingOwner != address(0), "vestingOwner address invalid");
		require(_lockedSOV != address(0), "LockedSOV address invalid");

		_setVestingFactory(_vestingFactory);
		SOV = _SOV;
		staking = _staking;
		feeSharingProxy = _feeSharingProxy;
		vestingOwner = _vestingOwner;
		lockedSOV = LockedSOV(_lockedSOV);
		for (uint256 i = 0; i < _vestingRegistries.length; i++) {
			require(_vestingRegistries[i] != address(0), "Vesting registry address invalid");
			vestingRegistries.push(IVestingRegistry(_vestingRegistries[i]));
		}
	}

	/**
	 * @notice sets vesting factory address
	 * @param _vestingFactory the address of vesting factory contract
	 */
	function setVestingFactory(address _vestingFactory) public onlyOwner {
		_setVestingFactory(_vestingFactory);
	}

	/**
	 * @notice Internal function that sets vesting factory address
	 * @param _vestingFactory the address of vesting factory contract
	 */
	function _setVestingFactory(address _vestingFactory) internal {
		require(_vestingFactory != address(0), "vestingFactory address invalid");
		vestingFactory = IVestingFactory(_vestingFactory);
	}

	/**
	 * @notice transfers SOV tokens to given address
	 * @param _receiver the address of the SOV receiver
	 * @param _amount the amount to be transferred
	 */
	function transferSOV(address _receiver, uint256 _amount) public onlyOwner {
		require(_receiver != address(0), "receiver address invalid");
		require(_amount != 0, "amount invalid");

		IERC20(SOV).transfer(_receiver, _amount);
		emit SOVTransferred(_receiver, _amount);
	}

	/**
	 * @notice adds vestings that were deployed in previous vesting registries
	 * @dev migration of data from previous vesting registy contracts
	 */
	function addDeployedVestings(address[] memory _tokenOwners, uint256[] memory _vestingCreationTypes) public onlyAuthorized {
		for (uint256 i = 0; i < _tokenOwners.length; i++) {
			require(_tokenOwners[i] != address(0), "token owner cannot be 0 address");
			require(_vestingCreationTypes[i] > 0, "vesting creation type must be greater than 0");
			_getDeployedVestings(_tokenOwners[i], _vestingCreationTypes[i]);
		}
	}

	/**
	 * @notice creates Vesting contract
	 * @param _tokenOwner the owner of the tokens
	 * @param _amount the amount to be staked
	 * @param _cliff the cliff in seconds
	 * @param _duration the total duration in seconds
	 * @dev Calls a public createVestingAddr function with vestingCreationType. This is to accomodate the existing logic for LockedSOV
	 * @dev vestingCreationType 0 = LockedSOV
	 */
	function createVesting(
		address _tokenOwner,
		uint256 _amount,
		uint256 _cliff,
		uint256 _duration
	) public onlyAuthorized {
		createVestingAddr(_tokenOwner, _amount, _cliff, _duration, 0);
	}

	/**
	 * @notice creates Vesting contract
	 * @param _tokenOwner the owner of the tokens
	 * @param _amount the amount to be staked
	 * @param _cliff the cliff in seconds
	 * @param _duration the total duration in seconds
	 * @param _vestingCreationType the type of vesting created(e.g. Origin, Bug Bounty etc.)
	 */
	function createVestingAddr(
		address _tokenOwner,
		uint256 _amount,
		uint256 _cliff,
		uint256 _duration,
		uint256 _vestingCreationType
	) public onlyAuthorized {
		address vesting = _getOrCreateVesting(_tokenOwner, _cliff, _duration, uint256(VestingType.Vesting), _vestingCreationType);
		emit VestingCreated(_tokenOwner, vesting, _cliff, _duration, _amount, _vestingCreationType);
	}

	/**
	 * @notice creates Team Vesting contract
	 * @param _tokenOwner the owner of the tokens
	 * @param _amount the amount to be staked
	 * @param _cliff the cliff in seconds
	 * @param _duration the total duration in seconds
	 * @param _vestingCreationType the type of vesting created(e.g. Origin, Bug Bounty etc.)
	 */
	function createTeamVesting(
		address _tokenOwner,
		uint256 _amount,
		uint256 _cliff,
		uint256 _duration,
		uint256 _vestingCreationType
	) public onlyAuthorized {
		address vesting = _getOrCreateVesting(_tokenOwner, _cliff, _duration, uint256(VestingType.TeamVesting), _vestingCreationType);
		emit TeamVestingCreated(_tokenOwner, vesting, _cliff, _duration, _amount, _vestingCreationType);
	}

	/**
	 * @notice stakes tokens according to the vesting schedule
	 * @param _vesting the address of Vesting contract
	 * @param _amount the amount of tokens to stake
	 */
	function stakeTokens(address _vesting, uint256 _amount) public onlyAuthorized {
		require(_vesting != address(0), "vesting address invalid");
		require(_amount > 0, "amount invalid");

		IERC20(SOV).approve(_vesting, _amount);
		IVesting(_vesting).stakeTokens(_amount);
		emit TokensStaked(_vesting, _amount);
	}

	/**
	 * @notice returns vesting contract address for the given token owner
	 * @param _tokenOwner the owner of the tokens
	 * @dev Calls a public getVestingAddr function with cliff and duration. This is to accomodate the existing logic for LockedSOV
	 * @dev We need to use LockedSOV.changeRegistryCliffAndDuration function very judiciously
	 * @dev vestingCreationType 0 - LockedSOV
	 */
	function getVesting(address _tokenOwner) public view returns (address) {
		return getVestingAddr(_tokenOwner, lockedSOV.cliff(), lockedSOV.duration(), 0);
	}

	/**
	 * @notice public function that returns vesting contract address for the given token owner, cliff, duration
	 * @dev Important: Please use this instead of getVesting function
	 */
	function getVestingAddr(
		address _tokenOwner,
		uint256 _cliff,
		uint256 _duration,
		uint256 _vestingCreationType
	) public view returns (address) {
		uint256 type_ = uint256(VestingType.Vesting);
		uint256 uid = uint256(keccak256(abi.encodePacked(_tokenOwner, type_, _cliff, _duration, _vestingCreationType)));
		return vestings[uid].vestingAddress;
	}

	/**
	 * @notice returns team vesting contract address for the given token owner, cliff, duration
	 */
	function getTeamVesting(
		address _tokenOwner,
		uint256 _cliff,
		uint256 _duration,
		uint256 _vestingCreationType
	) public view returns (address) {
		uint256 type_ = uint256(VestingType.TeamVesting);
		uint256 uid = uint256(keccak256(abi.encodePacked(_tokenOwner, type_, _cliff, _duration, _vestingCreationType)));
		return vestings[uid].vestingAddress;
	}

	/**
	 * @notice Internal function to deploy Vesting/Team Vesting contract
	 * @param _tokenOwner the owner of the tokens
	 * @param _cliff the cliff in seconds
	 * @param _duration the total duration in seconds
	 * @param _type the type of vesting
	 * @param _vestingCreationType the type of vesting created(e.g. Origin, Bug Bounty etc.)
	 */
	function _getOrCreateVesting(
		address _tokenOwner,
		uint256 _cliff,
		uint256 _duration,
		uint256 _type,
		uint256 _vestingCreationType
	) internal returns (address) {
		address vesting;
		uint256 uid = uint256(keccak256(abi.encodePacked(_tokenOwner, _type, _cliff, _duration, _vestingCreationType)));
		if (vestings[uid].vestingAddress == address(0)) {
			if (_type == 1) {
				vesting = vestingFactory.deployVesting(SOV, staking, _tokenOwner, _cliff, _duration, feeSharingProxy, _tokenOwner);
			} else {
				vesting = vestingFactory.deployTeamVesting(SOV, staking, _tokenOwner, _cliff, _duration, feeSharingProxy, vestingOwner);
			}
			vestings[uid] = Vesting(_type, _vestingCreationType, vesting);
			vestingsOf[_tokenOwner].push(uid);
		}
		return vestings[uid].vestingAddress;
	}

	/**
	 * @notice returns the addresses of Vesting contracts from all three previous versions of Vesting Registry
	 */
	function _getDeployedVestings(address _tokenOwner, uint256 _vestingCreationType) internal {
		uint256 vestingType = 1;
		uint256 teamVestingType = 0;
		uint256 uid;
		for (uint256 i = 0; i < vestingRegistries.length; i++) {
			address vestingAddress = vestingRegistries[i].getVesting(_tokenOwner);
			if (vestingAddress != address(0)) {
				VestingLogic vesting = VestingLogic(vestingAddress);
				uid = uint256(
					keccak256(abi.encodePacked(_tokenOwner, vestingType, vesting.cliff(), vesting.duration(), _vestingCreationType))
				);
				vestings[uid] = Vesting(vestingType, _vestingCreationType, vestingAddress);
				vestingsOf[_tokenOwner].push(uid);
			}
			address teamVestingAddress = vestingRegistries[i].getTeamVesting(_tokenOwner);
			if (teamVestingAddress != address(0)) {
				VestingLogic vesting = VestingLogic(teamVestingAddress);
				uid = uint256(
					keccak256(abi.encodePacked(_tokenOwner, teamVestingType, vesting.cliff(), vesting.duration(), _vestingCreationType))
				);
				vestings[uid] = Vesting(teamVestingType, _vestingCreationType, teamVestingAddress);
				vestingsOf[_tokenOwner].push(uid);
			}
		}
	}

	/**
	 * @notice returns all vesting details for the given token owner
	 */
	function getVestingsOf(address _tokenOwner) external view returns (Vesting[] memory) {
		uint256[] storage vestingIds = vestingsOf[_tokenOwner];
		Vesting[] memory _vestings = new Vesting[](vestingIds.length);
		for (uint256 i = 0; i < vestingIds.length; i++) {
			Vesting storage _vesting = vestings[vestingIds[i]];
			_vestings[i] = Vesting(_vesting.vestingType, _vesting.vestingCreationType, _vesting.vestingAddress);
		}
		return _vestings;
	}

	/**
	 * @notice returns cliff and duration for Vesting & TeamVesting contracts
	 */
	function getVestingDetails(address _vestingAddress) external view returns (uint256 cliff, uint256 duration) {
		VestingLogic vesting = VestingLogic(_vestingAddress);
		return (vesting.cliff(), vesting.duration());
	}
}
