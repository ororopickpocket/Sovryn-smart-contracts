pragma solidity ^0.5.17;

import "../../interfaces/IERC20.sol";
import "../../utils/AdminRole.sol";
import "./VestingRegistryLogic.sol";
import "./VestingLogic.sol";
import "../../openzeppelin/SafeMath.sol";

contract VestingCreator is AdminRole {
	using SafeMath for uint256;

	///@notice Boolean to check both vesting creation and staking is completed for a record
	bool vestingCreated;

	/// @notice 2 weeks in seconds.
	uint256 constant TWO_WEEKS = 1209600;

	///@notice the SOV token contract
	IERC20 public SOV;

	///@notice the vesting registry contract
	VestingRegistryLogic public vestingRegistryLogic;

	///@notice Holds Vesting Data
	struct VestingData {
		address tokenOwner;
		uint256 amount;
		uint256 cliff;
		uint256 duration;
		bool governanceControl; ///@dev true - tokens can be withdrawn by governance
		uint256 vestingCreationType;
	}

	///@notice list of vesting to be processed
	VestingData[] public vestingDataList;

	event SOVTransferred(address indexed receiver, uint256 amount);
	event TokensStaked(address indexed vesting, address indexed tokenOwner, uint256 amount);
	event VestingDataRemoved(address indexed caller, address tokenOwner);
	event DataCleared(address indexed caller);

	constructor(address _SOV, address _vestingRegistryLogic) public {
		require(_SOV != address(0), "SOV address invalid");
		require(_vestingRegistryLogic != address(0), "Vesting registry address invalid");

		SOV = IERC20(_SOV);
		vestingRegistryLogic = VestingRegistryLogic(_vestingRegistryLogic);
	}

	/**
	 * @notice transfers SOV tokens to given address
	 * @param _receiver the address of the SOV receiver
	 * @param _amount the amount to be transferred
	 */
	function transferSOV(address _receiver, uint256 _amount) public onlyOwner {
		require(_receiver != address(0), "receiver address invalid");
		require(_amount != 0, "amount invalid");

		require(SOV.transfer(_receiver, _amount), "transfer failed");
		emit SOVTransferred(_receiver, _amount);
	}

	/**
	 * @notice adds vestings to be processed to the list
	 * @dev if account doesn't have another vesting of the same type vesting data will be added to vestingDataList
	 */
	function addVestings(
		address[] memory _tokenOwners,
		uint256[] memory _amounts,
		uint256[] memory _cliffs,
		uint256[] memory _durations,
		bool[] memory _governanceControls,
		uint256[] memory _vestingCreationTypes
	) public onlyAuthorized {
		require(
			_tokenOwners.length == _amounts.length &&
				_tokenOwners.length == _cliffs.length &&
				_tokenOwners.length == _durations.length &&
				_tokenOwners.length == _governanceControls.length,
			"arrays mismatch"
		);

		for (uint256 i = 0; i < _tokenOwners.length; i++) {
			require(_durations[i] >= _cliffs[i], "duration must be bigger than or equal to the cliff");
			require(_amounts[i] > 0, "vesting amount cannot be 0");
			require(_tokenOwners[i] != address(0), "token owner cannot be 0 address");
			require(_cliffs[i].mod(TWO_WEEKS) == 0, "cliffs should have intervals of two weeks");
			require(_durations[i].mod(TWO_WEEKS) == 0, "durations should have intervals of two weeks");
			VestingData memory vestingData =
				VestingData({
					tokenOwner: _tokenOwners[i],
					amount: _amounts[i],
					cliff: _cliffs[i],
					duration: _durations[i],
					governanceControl: _governanceControls[i],
					vestingCreationType: _vestingCreationTypes[i]
				});
			vestingDataList.push(vestingData);
		}
	}

	/**
	 * @notice Creates vesting contract and stakes tokens
	 * @dev Vesting and Staking are merged for calls that fits the gas limit
	 */
	function processNextVesting() public onlyAuthorized {
		processVestingCreation();
		processStaking();
	}

	/**
	 * @notice Creates vesting contract without staking any tokens
	 * @dev Separating the Vesting and Staking to tackle Block Gas Limit
	 */
	function processVestingCreation() public onlyAuthorized {
		require(vestingCreated == false, "staking not done for the previous vesting");
		if (vestingDataList.length > 0) {
			VestingData storage vestingData = vestingDataList[vestingDataList.length - 1];
			_createAndGetVesting(vestingData);
			vestingCreated = true;
		}
	}

	/**
	 * @notice Staking vested tokens
	 * @dev it can be the case when vesting creation and tokens staking can't be done in one transaction because of block gas limit
	 */
	function processStaking() public onlyAuthorized {
		require(vestingCreated == true, "cannot stake without vesting creation");
		if (vestingDataList.length > 0) {
			VestingData storage vestingData = vestingDataList[vestingDataList.length - 1];
			address vestingAddress =
				_getVesting(
					vestingData.tokenOwner,
					vestingData.cliff,
					vestingData.duration,
					vestingData.governanceControl,
					vestingData.vestingCreationType
				);
			if (vestingAddress != address(0)) {
				VestingLogic vesting = VestingLogic(vestingAddress);
				SOV.approve(address(vesting), vestingData.amount);
				vesting.stakeTokens(vestingData.amount);
				emit TokensStaked(vestingAddress, vestingData.tokenOwner, vestingData.amount);
				vestingCreated = false;
				address tokenOwnerDetails = vestingData.tokenOwner;
				delete vestingDataList[vestingDataList.length - 1];
				vestingDataList.length--;
				emit VestingDataRemoved(msg.sender, tokenOwnerDetails);
			}
		}
	}

	/**
	 * @notice removes next vesting data from the list
	 * @dev we process inverted list
	 * @dev we should be able to remove incorrect vesting data that can't be processed
	 */
	function removeNextVesting() public onlyAuthorized {
		address tokenOwnerDetails;
		if (vestingDataList.length > 0) {
			VestingData storage vestingData = vestingDataList[vestingDataList.length - 1];
			tokenOwnerDetails = vestingData.tokenOwner;
			delete vestingDataList[vestingDataList.length - 1];
			vestingDataList.length--;
			emit VestingDataRemoved(msg.sender, tokenOwnerDetails);
		}
	}

	/**
	 * @notice removes all data about unprocessed vestings to be processed
	 */
	function clearVestingDataList() public onlyAuthorized {
		delete vestingDataList;
		emit DataCleared(msg.sender);
	}

	/**
	 * @notice returns address after vesting creation
	 */
	function getVestingAddress() public view returns (address) {
		return
			_getVesting(
				vestingDataList[vestingDataList.length - 1].tokenOwner,
				vestingDataList[vestingDataList.length - 1].cliff,
				vestingDataList[vestingDataList.length - 1].duration,
				vestingDataList[vestingDataList.length - 1].governanceControl,
				vestingDataList[vestingDataList.length - 1].vestingCreationType
			);
	}

	/**
	 * @notice returns period i.e. (duration - cliff / 4 WEEKS)
	 * @dev will be used for deciding if vesting and staking needs to be processed
	 * in a single transaction or separate transactions
	 */
	function getVestingPeriod() public view returns (uint256) {
		uint256 duration = vestingDataList[vestingDataList.length - 1].duration;
		uint256 cliff = vestingDataList[vestingDataList.length - 1].cliff;
		uint256 fourWeeks = TWO_WEEKS.mul(2);
		uint256 period = duration.sub(cliff).div(fourWeeks);
		return period;
	}

	/**
	 * @notice returns count of vestings to be processed
	 */
	function getUnprocessedCount() public view returns (uint256) {
		return vestingDataList.length;
	}

	/**
	 * @notice returns total amount of vestings to be processed
	 */
	function getUnprocessedAmount() public view returns (uint256) {
		uint256 amount = 0;
		for (uint256 i = 0; i < vestingDataList.length; i++) {
			amount = amount.add(vestingDataList[i].amount);
		}
		return amount;
	}

	/**
	 * @notice checks if contract balance is enough to process all vestings
	 */
	function isEnoughBalance() public view returns (bool) {
		return SOV.balanceOf(address(this)) >= getUnprocessedAmount();
	}

	/**
	 * @notice returns missed balance to process all vestings
	 */
	function getMissingBalance() public view returns (uint256) {
		if (isEnoughBalance()) {
			return 0;
		}
		return getUnprocessedAmount() - SOV.balanceOf(address(this));
	}

	/**
	 * @notice creates TeamVesting or Vesting contract
	 * @dev new contract won't be created if account already has contract of the same type
	 */
	function _createAndGetVesting(VestingData storage vestingData) internal returns (address vesting) {
		if (vestingData.governanceControl) {
			vestingRegistryLogic.createTeamVesting(
				vestingData.tokenOwner,
				vestingData.amount,
				vestingData.cliff,
				vestingData.duration,
				vestingData.vestingCreationType
			);
		} else {
			vestingRegistryLogic.createVestingAddr(
				vestingData.tokenOwner,
				vestingData.amount,
				vestingData.cliff,
				vestingData.duration,
				vestingData.vestingCreationType
			);
		}
		return
			_getVesting(
				vestingData.tokenOwner,
				vestingData.cliff,
				vestingData.duration,
				vestingData.governanceControl,
				vestingData.vestingCreationType
			);
	}

	/**
	 * @notice returns an address of TeamVesting or Vesting contract (depends on a governance control)
	 */
	function _getVesting(
		address _tokenOwner,
		uint256 _cliff,
		uint256 _duration,
		bool _governanceControl,
		uint256 _vestingCreationType
	) internal view returns (address vestingAddress) {
		if (_governanceControl) {
			vestingAddress = vestingRegistryLogic.getTeamVesting(_tokenOwner, _cliff, _duration, _vestingCreationType);
		} else {
			vestingAddress = vestingRegistryLogic.getVestingAddr(_tokenOwner, _cliff, _duration, _vestingCreationType);
		}
	}
}
