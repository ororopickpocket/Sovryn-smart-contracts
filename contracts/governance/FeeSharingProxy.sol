pragma solidity ^0.5.17;

import "./Staking/SafeMath96.sol";
import "../openzeppelin/SafeMath.sol";
import "../openzeppelin/SafeERC20.sol";
import "../openzeppelin/Ownable.sol";
import "./IFeeSharingProxy.sol";
import "./Staking/IStaking.sol";

/**
 * @title The FeeSharingProxy contract.
 * @notice Staking is not only granting voting rights, but also access to fee
 * sharing according to the own voting power in relation to the total. Whenever
 * somebody decides to collect the fees from the protocol, they get transferred
 * to a proxy contract which invests the funds in the lending pool and keeps
 * the pool tokens.
 *
 * The fee sharing proxy will be set as feesController of the protocol contract.
 * This allows the fee sharing proxy to withdraw the fees. The fee sharing
 * proxy holds the pool tokens and keeps track of which user owns how many
 * tokens. In order to know how many tokens a user owns, the fee sharing proxy
 * needs to know the user’s weighted stake in relation to the total weighted
 * stake (aka total voting power).
 *
 * Because both values are subject to change, they may be different on each fee
 * withdrawal. To be able to calculate a user’s share of tokens when he wants
 * to withdraw, we need checkpoints.
 *
 * This contract is intended to be set as the protocol fee collector.
 * Anybody can invoke the withdrawFees function which uses
 * protocol.withdrawFees to obtain available fees from operations on a
 * certain token. These fees are deposited in the corresponding loanPool.
 * Also, the staking contract sends slashed tokens to this contract. When a
 * user calls the withdraw function, the contract transfers the fee sharing
 * rewards in proportion to the user’s weighted stake since the last withdrawal.
 *
 * The protocol is collecting fees in all sorts of currencies and then automatically
 * supplies them to the respective lending pools. Therefore, all fees are
 * generating interest for the SOV holders. If one of them withdraws fees, it will
 * get pool tokens. It is planned to add the option to convert anything to rBTC
 * before withdrawing, but not yet implemented.
 * */
contract FeeSharingProxy is SafeMath96, IFeeSharingProxy, Ownable {
	using SafeMath for uint256;
	using SafeERC20 for IERC20;

	/* Storage */

	/// @dev TODO FEE_WITHDRAWAL_INTERVAL, MAX_CHECKPOINTS
	uint256 constant FEE_WITHDRAWAL_INTERVAL = 86400;

	uint32 constant MAX_CHECKPOINTS = 100;
	
	address public wRBTCAddress;

	IProtocol public protocol;
	IStaking public staking;

	/// @notice Checkpoints by index per pool token address
	mapping(address => mapping(uint256 => Checkpoint)) public tokenCheckpoints;

	/// @notice The number of checkpoints for each pool token address.
	mapping(address => uint32) public numTokenCheckpoints;

	/// @notice
	/// user => token => processed checkpoint
	mapping(address => mapping(address => uint32)) public processedCheckpoints;

	/// @notice Last time fees were withdrawn per pool token address:
	/// token => time
	mapping(address => uint256) public lastFeeWithdrawalTime;

	/// @notice Amount of tokens that were transferred, but not saved in checkpoints.
	/// token => amount
	mapping(address => uint96) public unprocessedAmount;

	struct Checkpoint {
		uint32 blockNumber;
		uint32 timestamp;
		uint96 totalWeightedStake;
		uint96 numTokens;
	}

	/* Events */

	/// @notice An event emitted when fee get withdrawn.
	event FeeWithdrawn(address indexed sender, address indexed token, uint256 amount);

	/// @notice An event emitted when tokens transferred.
	event TokensTransferred(address indexed sender, address indexed token, uint256 amount);

	/// @notice An event emitted when checkpoint added.
	event CheckpointAdded(address indexed sender, address indexed token, uint256 amount);

	/// @notice An event emitted when user fee get withdrawn.
	event UserFeeWithdrawn(address indexed sender, address indexed receiver, address indexed token, uint256 amount);

	/// @notice An event emitted when user set wrbtc address.
	event SetWrbtcToken(address indexed sender, address indexed oldWRBTCAddress, address indexed newWRBTCAddress);

	/* Functions */

	constructor(IProtocol _protocol, IStaking _staking, address _wRBTCAddress) public {
		protocol = _protocol;
		staking = _staking;
		wRBTCAddress = _wRBTCAddress;
	}

	/**
	 * @notice Set new wRBTC address
	 *
	 * @param newWRBTCAddress new wRBTC addres
	 * */
	function setWRBTCAddress(address newWRBTCAddress) external onlyOwner {
		address oldWRBTCAddress = wRBTCAddress;
		wRBTCAddress = newWRBTCAddress;
		emit SetWrbtcToken(msg.sender, oldWRBTCAddress, newWRBTCAddress);
	}

	/**
	 * @notice Withdraw fees for the given token:
	 * lendingFee + tradingFee + borrowingFee
	 * the fees will be converted in wRBTC form, and then will be transferred to wRBTC loan pool
	 *
	 * @param _tokens array address of the token
	 * */
	function withdrawFees(address[] memory _tokens) public {
		for (uint256 i = 0; i < _tokens.length; i++) {
 			require(_tokens[i] != address(0), "FeeSharingProxy::withdrawFees: invalid address");
		}

		address loanPoolToken = protocol.underlyingToLoanPool(wRBTCAddress);
		require(loanPoolToken != address(0), "FeeSharingProxy::withdrawFees: loan wRBTC not found");

		uint256 amount = protocol.withdrawFees(_tokens, address(this));
		require(amount > 0, "FeeSharingProxy::withdrawFees: no tokens to withdraw");

		/// @dev TODO can be also used - function addLiquidity(IERC20Token _reserveToken, uint256 _amount, uint256 _minReturn)
		IERC20(wRBTCAddress).approve(loanPoolToken, amount);
		uint256 poolTokenAmount = ILoanToken(loanPoolToken).mint(address(this), amount);

		/// @notice Update unprocessed amount of tokens
		uint96 amount96 = safe96(poolTokenAmount, "FeeSharingProxy::withdrawFees: pool token amount exceeds 96 bits");
		unprocessedAmount[loanPoolToken] = add96(
			unprocessedAmount[loanPoolToken],
			amount96,
			"FeeSharingProxy::withdrawFees: unprocessedAmount exceeds 96 bits"
		);

		_addCheckpoint(loanPoolToken);

		emit FeeWithdrawn(msg.sender, loanPoolToken, poolTokenAmount);
	}

	/**
	 * @notice Transfer tokens to this contract.
	 * @dev We just update amount of tokens here and write checkpoint in a separate methods
	 * in order to prevent adding checkpoints too often.
	 * @param _token Address of the token.
	 * @param _amount Amount to be transferred.
	 * */
	function transferTokens(address _token, uint96 _amount) public {
		require(_token != address(0), "FeeSharingProxy::transferTokens: invalid address");
		require(_amount > 0, "FeeSharingProxy::transferTokens: invalid amount");

		/// @notice Transfer tokens from msg.sender
		bool success = IERC20(_token).transferFrom(address(msg.sender), address(this), _amount);
		require(success, "Staking::transferTokens: token transfer failed");

		/// @notice Update unprocessed amount of tokens.
		unprocessedAmount[_token] = add96(unprocessedAmount[_token], _amount, "FeeSharingProxy::transferTokens: amount exceeds 96 bits");

		_addCheckpoint(_token);

		emit TokensTransferred(msg.sender, _token, _amount);
	}

	/**
	 * @notice Add checkpoint with accumulated amount by function invocation.
	 * @param _token Address of the token.
	 * */
	function _addCheckpoint(address _token) internal {
		if (block.timestamp - lastFeeWithdrawalTime[_token] >= FEE_WITHDRAWAL_INTERVAL) {
			lastFeeWithdrawalTime[_token] = block.timestamp;
			uint96 amount = unprocessedAmount[_token];

			/// @notice Reset unprocessed amount of tokens to zero.
			unprocessedAmount[_token] = 0;

			/// @notice Write a regular checkpoint.
			_writeTokenCheckpoint(_token, amount);
		}
	}

	/**
	 * @notice Withdraw accumulated fee to the message sender.
	 *
	 * The Sovryn protocol collects fees on every trade/swap and loan.
	 * These fees will be distributed to SOV stakers based on their voting
	 * power as a percentage of total voting power. Therefore, staking more
	 * SOV and/or staking for longer will increase your share of the fees
	 * generated, meaning you will earn more from staking.
	 *
	 * This function will directly burnToBTC and use the msg.sender (user) as the receiver
	 *
	 * @param _loanPoolToken Address of the pool token.
	 * @param _maxCheckpoints Maximum number of checkpoints to be processed.
	 * @param _receiver The receiver of tokens or msg.sender
	 * */
	function withdraw(
		address _loanPoolToken,
		uint32 _maxCheckpoints,
		address _receiver
	) public {
		/// @dev Prevents processing all checkpoints because of block gas limit.
		require(_maxCheckpoints > 0, "FeeSharingProxy::withdraw: _maxCheckpoints should be positive");

		address loanPoolTokenWRBTC = protocol.underlyingToLoanPool(wRBTCAddress);
		require(loanPoolTokenWRBTC != address(0), "FeeSharingProxy::withdrawFees: loan wRBTC not found");

		address user = msg.sender;
		if (_receiver == address(0)) {
			_receiver = msg.sender;
		}

		uint256 amount;
		uint32 end;
		(amount, end) = _getAccumulatedFees(user, _loanPoolToken, _maxCheckpoints);

		processedCheckpoints[user][_loanPoolToken] = end;
		
		if(loanPoolTokenWRBTC == _loanPoolToken) {
			// We will change, so that feeSharingProxy will directly burn then loanToken (IWRBTC) to rbtc and send to the user --- by call burnToBTC function
			uint256 loanAmountPaid = ILoanTokenWRBTC(_loanPoolToken).burnToBTC(_receiver, amount, false);
		} else {
			// Previously it directly send the loanToken to the user
			require(IERC20(_loanPoolToken).transfer(user, amount), "FeeSharingProxy::withdraw: withdrawal failed");
		}

		emit UserFeeWithdrawn(msg.sender, _receiver, _loanPoolToken, amount);
	}

	/**
	 * @notice Get the accumulated loan pool fee of the message sender.
	 * @param _user The address of the user or contract.
	 * @param _loanPoolToken Address of the pool token.
	 * @return The accumulated fee for the message sender.
	 * */
	function getAccumulatedFees(address _user, address _loanPoolToken) public view returns (uint256) {
		uint256 amount;
		(amount, ) = _getAccumulatedFees(_user, _loanPoolToken, 0);
		return amount;
	}

	/**
	 * @notice Whenever fees are withdrawn, the staking contract needs to
	 * checkpoint the block number, the number of pool tokens and the
	 * total voting power at that time (read from the staking contract).
	 * While the total voting power would not necessarily need to be
	 * checkpointed, it makes sense to save gas cost on withdrawal.
	 *
	 * When the user wants to withdraw its share of tokens, we need
	 * to iterate over all of the checkpoints since the users last
	 * withdrawal (note: remember last withdrawal block), query the
	 * user’s balance at the checkpoint blocks from the staking contract,
	 * compute his share of the checkpointed tokens and add them up.
	 * The maximum number of checkpoints to process at once should be limited.
	 *
	 * @param _user Address of the user's account.
	 * @param _loanPoolToken Loan pool token address.
	 * @param _maxCheckpoints Checkpoint index incremental.
	 * */
	function _getAccumulatedFees(
		address _user,
		address _loanPoolToken,
		uint32 _maxCheckpoints
	) internal view returns (uint256, uint32) {
		uint32 start = processedCheckpoints[_user][_loanPoolToken];
		uint32 end;
		/// @dev Additional bool param can't be used because of stack too deep error.
		if (_maxCheckpoints > 0) {
			/// @dev withdraw -> _getAccumulatedFees
			require(start < numTokenCheckpoints[_loanPoolToken], "FeeSharingProxy::withdrawFees: no tokens for a withdrawal");
			end = _getEndOfRange(start, _loanPoolToken, _maxCheckpoints);
		} else {
			/// @dev getAccumulatedFees -> _getAccumulatedFees
			/// Don't throw error for getter invocation outside of transaction.
			if (start >= numTokenCheckpoints[_loanPoolToken]) {
				return (0, numTokenCheckpoints[_loanPoolToken]);
			}
			end = numTokenCheckpoints[_loanPoolToken];
		}

		uint256 amount = 0;
		uint256 cachedLockDate = 0;
		uint96 cachedWeightedStake = 0;
		for (uint32 i = start; i < end; i++) {
			Checkpoint storage checkpoint = tokenCheckpoints[_loanPoolToken][i];
			uint256 lockDate = staking.timestampToLockDate(checkpoint.timestamp);
			uint96 weightedStake;
			if (lockDate == cachedLockDate) {
				weightedStake = cachedWeightedStake;
			} else {
				/// @dev We need to use "checkpoint.blockNumber - 1" here to calculate weighted stake
				/// For the same block like we did for total voting power in _writeTokenCheckpoint
				weightedStake = staking.getPriorWeightedStake(_user, checkpoint.blockNumber - 1, checkpoint.timestamp);
				cachedWeightedStake = weightedStake;
				cachedLockDate = lockDate;
			}
			uint256 share = uint256(checkpoint.numTokens).mul(weightedStake).div(uint256(checkpoint.totalWeightedStake));
			amount = amount.add(share);
		}
		return (amount, end);
	}

	/**
	 * @notice Withdrawal should only be possible for blocks which were already
	 * mined. If the fees are withdrawn in the same block as the user withdrawal
	 * they are not considered by the withdrawing logic (to avoid inconsistencies).
	 *
	 * @param start Start of the range.
	 * @param _loanPoolToken Loan pool token address.
	 * @param _maxCheckpoints Checkpoint index incremental.
	 * */
	function _getEndOfRange(
		uint32 start,
		address _loanPoolToken,
		uint32 _maxCheckpoints
	) internal view returns (uint32) {
		uint32 nCheckpoints = numTokenCheckpoints[_loanPoolToken];
		uint32 end;
		if (_maxCheckpoints == 0) {
			/// @dev All checkpoints will be processed (only for getter outside of a transaction).
			end = nCheckpoints;
		} else {
			if (_maxCheckpoints > MAX_CHECKPOINTS) {
				_maxCheckpoints = MAX_CHECKPOINTS;
			}
			end = safe32(start + _maxCheckpoints, "FeeSharingProxy::withdraw: checkpoint index exceeds 32 bits");
			if (end > nCheckpoints) {
				end = nCheckpoints;
			}
		}

		/// @dev Withdrawal should only be possible for blocks which were already mined.
		uint32 lastBlockNumber = tokenCheckpoints[_loanPoolToken][end - 1].blockNumber;
		if (block.number == lastBlockNumber) {
			end--;
		}
		return end;
	}

	/**
	 * @notice Write a regular checkpoint w/ the foolowing data:
	 * block number, block timestamp, total weighted stake and num of tokens.
	 * @param _token The pool token address.
	 * @param _numTokens The amount of pool tokens.
	 * */
	function _writeTokenCheckpoint(address _token, uint96 _numTokens) internal {
		uint32 blockNumber = safe32(block.number, "FeeSharingProxy::_writeCheckpoint: block number exceeds 32 bits");
		uint32 blockTimestamp = safe32(block.timestamp, "FeeSharingProxy::_writeCheckpoint: block timestamp exceeds 32 bits");
		uint32 nCheckpoints = numTokenCheckpoints[_token];

		uint96 totalWeightedStake = staking.getPriorTotalVotingPower(blockNumber - 1, block.timestamp);
		if (nCheckpoints > 0 && tokenCheckpoints[_token][nCheckpoints - 1].blockNumber == blockNumber) {
			tokenCheckpoints[_token][nCheckpoints - 1].totalWeightedStake = totalWeightedStake;
			tokenCheckpoints[_token][nCheckpoints - 1].numTokens = _numTokens;
		} else {
			tokenCheckpoints[_token][nCheckpoints] = Checkpoint(blockNumber, blockTimestamp, totalWeightedStake, _numTokens);
			numTokenCheckpoints[_token] = nCheckpoints + 1;
		}
		emit CheckpointAdded(msg.sender, _token, _numTokens);
	}
}

/* Interfaces */

interface IProtocol {
	/**
	 *
	 * @param tokens The array address of the token instance.
	 * @param receiver The address of the withdrawal recipient.
	 *
	 * @return The withdrawn total amount in wRBTC
	 * */
	function withdrawFees(address[] calldata tokens, address receiver) external returns (uint256);

	function underlyingToLoanPool(address token) external returns (address);
}

interface ILoanToken {
	function mint(address receiver, uint256 depositAmount) external returns (uint256 mintAmount);
}

interface ILoanTokenWRBTC {
	function burnToBTC(address receiver, uint256 burnAmount, bool useLM) external returns (uint256 loanAmountPaid);
}
