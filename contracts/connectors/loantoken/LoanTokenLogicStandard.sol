/**
 * Copyright 2017-2020, bZeroX, LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0.
 */

pragma solidity 0.5.17;
pragma experimental ABIEncoderV2;

import "./LoanTokenSettingsLowerAdmin.sol";
import "./interfaces/ProtocolLike.sol";
import "./interfaces/FeedsLike.sol";
import "../../modules/interfaces/ProtocolAffiliatesInterface.sol";

contract LoanTokenLogicStandard is LoanTokenSettingsLowerAdmin {
	using SignedSafeMath for int256;

	// DON'T ADD VARIABLES HERE, PLEASE

	uint256 public constant VERSION = 5;

	// address internal constant arbitraryCaller = 0x000F400e6818158D541C3EBE45FE3AA0d47372FF; // ethereum address! replaced by  arbitraryCallerAddress in LoanTokenSettingsLowerAdmin

	function() external {
		revert("loan token logic - fallback not allowed");
	}

	/* Public functions */

	function mint(address receiver, uint256 depositAmount) external nonReentrant hasEarlyAccessToken returns (uint256 mintAmount) {
		//temporary: limit transaction size
		if (transactionLimit[loanTokenAddress] > 0) require(depositAmount <= transactionLimit[loanTokenAddress]);

		return _mintToken(receiver, depositAmount);
	}

	function burn(address receiver, uint256 burnAmount) external nonReentrant returns (uint256 loanAmountPaid) {
		loanAmountPaid = _burnToken(burnAmount);

		if (loanAmountPaid != 0) {
			_safeTransfer(loanTokenAddress, receiver, loanAmountPaid, "5");
		}
	}

	/*flashBorrow is disabled for the MVP, but is going to be added later.
    therefore, it needs to be revised*/

	function flashBorrow(
		uint256 borrowAmount,
		address borrower,
		address target,
		string calldata signature,
		bytes calldata data
	) external payable nonReentrant onlyFlashLoanWhiteListed(borrower) returns (bytes memory) {
		require(borrowAmount != 0, "38");
		//AUDIT: the borrower parameter can be removed
		require(borrower == msg.sender, "unauthorised usage of a whitelisted address");

		_checkPause();

		_settleInterest();

		// save before balances
		uint256 beforeEtherBalance = address(this).balance.sub(msg.value);
		uint256 beforeAssetsBalance = _underlyingBalance().add(totalAssetBorrow());

		// lock totalAssetSupply for duration of flash loan
		_flTotalAssetSupply = beforeAssetsBalance;

		// transfer assets to calling contract
		_safeTransfer(loanTokenAddress, borrower, borrowAmount, "39");

		bytes memory callData;
		if (bytes(signature).length == 0) {
			callData = data;
		} else {
			callData = abi.encodePacked(bytes4(keccak256(bytes(signature))), data);
		}

		// arbitrary call
		require(arbitraryCallerAddress != address(0), "arbitraryCallerAddress is not set");
		(bool success, bytes memory returnData) =
			arbitraryCallerAddress.call.value(msg.value)(
				abi.encodeWithSelector(
					0xde064e0d, // sendCall(address,bytes)
					target,
					callData
				)
			);
		require(success, "arbitraryCallerAddress.call failed");

		// unlock totalAssetSupply
		_flTotalAssetSupply = 0;

		require(address(this).balance >= beforeEtherBalance && _underlyingBalance().add(totalAssetBorrow()) >= beforeAssetsBalance, "40");

		return returnData;
	}

	/**
	 * borrows funds from the pool. The underlying loan token may not be used as collateral.
	 * @param loanId the ID of the loan, 0 for a new loan
	 * @param withdrawAmount the amount to be withdrawn (actually borrowed)
	 * @param initialLoanDuration the duration of the loan in seconds. if the loan is not paid back until then, it'll need to be rolled over
	 * @param collateralTokenSent the amount of collateral token sent (150% of the withdrawn amount worth in collateral tokenns)
	 * @param collateralTokenAddress the address of the tokenn to be used as collateral. cannot be the loan token address
	 * @param borrower the one paying for the collateral
	 * @param receiver the one receiving the withdrawn amount
	 * */
	function borrow(
		bytes32 loanId, // 0 if new loan
		uint256 withdrawAmount,
		uint256 initialLoanDuration, // duration in seconds
		uint256 collateralTokenSent, // if 0, loanId must be provided; any ETH sent must equal this value
		address collateralTokenAddress, // if address(0), this means ETH and ETH must be sent with the call or loanId must be provided
		address borrower,
		address receiver,
		bytes memory // arbitrary order data (for future use) /*loanDataBytes*/
	)
		public
		payable
		nonReentrant //note: needs to be removed to allow flashloan use cases?
		hasEarlyAccessToken
		returns (
			uint256,
			uint256 // returns new principal and new collateral added to loan
		)
	{
		require(withdrawAmount != 0, "6");

		_checkPause();

		//temporary: limit transaction size
		if (transactionLimit[collateralTokenAddress] > 0) require(collateralTokenSent <= transactionLimit[collateralTokenAddress]);

		require(msg.value == 0 || msg.value == collateralTokenSent, "7");
		require(collateralTokenSent != 0 || loanId != 0, "8");
		require(collateralTokenAddress != address(0) || msg.value != 0 || loanId != 0, "9");

		if (collateralTokenAddress == address(0)) {
			collateralTokenAddress = wrbtcTokenAddress;
		}
		require(collateralTokenAddress != loanTokenAddress, "10");

		_settleInterest();

		address[4] memory sentAddresses;
		uint256[5] memory sentAmounts;

		sentAddresses[0] = address(this); // lender
		sentAddresses[1] = borrower;
		sentAddresses[2] = receiver;
		//sentAddresses[3] = address(0); // manager

		sentAmounts[1] = withdrawAmount;

		// interestRate, interestInitialAmount, borrowAmount (newBorrowAmount)
		(sentAmounts[0], sentAmounts[2], sentAmounts[1]) = _getInterestRateAndBorrowAmount(
			sentAmounts[1],
			_totalAssetSupply(0), // interest is settled above
			initialLoanDuration
		);

		//sentAmounts[3] = 0; // loanTokenSent
		sentAmounts[4] = collateralTokenSent;

		return
			_borrowOrTrade(
				loanId,
				withdrawAmount,
				2 * 10**18, // leverageAmount (translates to 150% margin for a Torque loan)
				collateralTokenAddress,
				sentAddresses,
				sentAmounts,
				"" // loanDataBytes
			);
	}

	// Called to borrow and immediately get into a positions
	function marginTrade(
		bytes32 loanId, // 0 if new loan
		uint256 leverageAmount, // expected in x * 10**18 where x is the actual leverage (2, 3, 4, or 5)
		uint256 loanTokenSent,
		uint256 collateralTokenSent,
		address collateralTokenAddress,
		address trader,
		bytes memory loanDataBytes // arbitrary order data
	)
		public
		payable
		nonReentrant //note: needs to be removed to allow flashloan use cases?
		hasEarlyAccessToken
		returns (
			uint256,
			uint256 // returns new principal and new collateral added to trade
		)
	{
		_checkPause();

		if (collateralTokenAddress == address(0)) {
			collateralTokenAddress = wrbtcTokenAddress;
		}

		require(collateralTokenAddress != loanTokenAddress, "11");

		//temporary: limit transaction size
		if (transactionLimit[collateralTokenAddress] > 0) require(collateralTokenSent <= transactionLimit[collateralTokenAddress]);
		if (transactionLimit[loanTokenAddress] > 0) require(loanTokenSent <= transactionLimit[loanTokenAddress]);

		//computes the worth of the total deposit in loan tokens.
		//(loanTokenSent + convert(collateralTokenSent))
		//no actual swap happening here.
		uint256 totalDeposit = _totalDeposit(collateralTokenAddress, collateralTokenSent, loanTokenSent);
		require(totalDeposit != 0, "12");

		address[4] memory sentAddresses;
		uint256[5] memory sentAmounts;

		sentAddresses[0] = address(this); // lender
		sentAddresses[1] = trader;
		sentAddresses[2] = trader;
		//sentAddresses[3] = address(0); // manager

		//sentAmounts[0] = 0; // interestRate (found later)
		sentAmounts[1] = totalDeposit; // total amount of deposit
		//sentAmounts[2] = 0; // interestInitialAmount (interest is calculated based on fixed-term loan)
		sentAmounts[3] = loanTokenSent;
		sentAmounts[4] = collateralTokenSent;

		_settleInterest();

		(sentAmounts[1], sentAmounts[0]) = _getMarginBorrowAmountAndRate( // borrowAmount, interestRate
			leverageAmount,
			sentAmounts[1] // depositAmount
		);

		return
			_borrowOrTrade(
				loanId,
				0, // withdrawAmount
				leverageAmount,
				collateralTokenAddress,
				sentAddresses,
				sentAmounts,
				loanDataBytes
			);
	}

	function marginTradeAffiliate(
		bytes32 loanId, // 0 if new loan
		uint256 leverageAmount, // expected in x * 10**18 where x is the actual leverage (2, 3, 4, or 5)
		uint256 loanTokenSent,
		uint256 collateralTokenSent,
		address collateralTokenAddress,
		address trader,
		address affiliateReferrer, // the user was brought by the affiliate (referrer)
		bytes memory loanDataBytes // arbitrary order data
	)
		public
		payable
		returns (
			uint256,
			uint256 // returns new principal and new collateral added to trade
		)
	{
		if (affiliateReferrer != address(0))
			ProtocolAffiliatesInterface(sovrynContractAddress).setAffiliatesReferrer(trader, affiliateReferrer);
		return marginTrade(loanId, leverageAmount, loanTokenSent, collateralTokenSent, collateralTokenAddress, trader, loanDataBytes);
	}

	function transfer(address _to, uint256 _value) external returns (bool) {
		return _internalTransferFrom(msg.sender, _to, _value, uint256(-1));
	}

	function transferFrom(
		address _from,
		address _to,
		uint256 _value
	) external returns (bool) {
		return
			_internalTransferFrom(
				_from,
				_to,
				_value,
				ProtocolLike(sovrynContractAddress).isLoanPool(msg.sender) ? uint256(-1) : allowed[_from][msg.sender]
			);
	}

	function _internalTransferFrom(
		address _from,
		address _to,
		uint256 _value,
		uint256 _allowanceAmount
	) internal returns (bool) {
		if (_allowanceAmount != uint256(-1)) {
			require(_value <= _allowanceAmount, "14");
			allowed[_from][msg.sender] = _allowanceAmount.sub(_value);
		}

		uint256 _balancesFrom = balances[_from];
		require(_value <= _balancesFrom && _to != address(0), "14");

		uint256 _balancesFromNew = _balancesFrom.sub(_value);
		balances[_from] = _balancesFromNew;

		uint256 _balancesTo = balances[_to];
		uint256 _balancesToNew = _balancesTo.add(_value);
		balances[_to] = _balancesToNew;

		// handle checkpoint update
		uint256 _currentPrice = tokenPrice();

		_updateCheckpoints(_from, _balancesFrom, _balancesFromNew, _currentPrice);
		_updateCheckpoints(_to, _balancesTo, _balancesToNew, _currentPrice);

		emit Transfer(_from, _to, _value);
		return true;
	}

	/**
	 * @dev updates the user's checkpoint price and profit so far.
	 * @param _user the user address
	 * @param _oldBalance the user's previous balance
	 * @param _newBalance the user's updated balance
	 * @param _currentPrice the current iToken price
	 * */
	function _updateCheckpoints(
		address _user,
		uint256 _oldBalance,
		uint256 _newBalance,
		uint256 _currentPrice
	) internal {
		// keccak256("iToken_ProfitSoFar")
		bytes32 slot = keccak256(abi.encodePacked(_user, uint256(0x37aa2b7d583612f016e4a4de4292cb015139b3d7762663d06a53964912ea2fb6)));

		uint256 _currentProfit;
		if (_oldBalance != 0 && _newBalance != 0) {
			_currentProfit = _profitOf(slot, _oldBalance, _currentPrice, checkpointPrices_[_user]);
		} else if (_newBalance == 0) {
			_currentPrice = 0;
		}

		assembly {
			sstore(slot, _currentProfit)
		}

		checkpointPrices_[_user] = _currentPrice;
	}

	/* Public View functions */

	function profitOf(address user) public view returns (uint256) {
		// keccak256("iToken_ProfitSoFar")
		bytes32 slot = keccak256(abi.encodePacked(user, uint256(0x37aa2b7d583612f016e4a4de4292cb015139b3d7762663d06a53964912ea2fb6)));

		return _profitOf(slot, balances[user], tokenPrice(), checkpointPrices_[user]);
	}

	function _profitOf(
		bytes32 slot,
		uint256 _balance,
		uint256 _currentPrice,
		uint256 _checkpointPrice
	) internal view returns (uint256) {
		if (_checkpointPrice == 0) {
			return 0;
		}

		uint256 profitSoFar;
		uint256 profitDiff;

		assembly {
			profitSoFar := sload(slot)
		}

		if (_currentPrice > _checkpointPrice) {
			profitDiff = _balance.mul(_currentPrice - _checkpointPrice).div(10**18);
			profitSoFar = profitSoFar.add(profitDiff);
		} else {
			profitDiff = _balance.mul(_checkpointPrice - _currentPrice).div(10**18);
			if (profitSoFar > profitDiff) {
				profitSoFar = profitSoFar - profitDiff;
			} else {
				profitSoFar = 0;
			}
		}

		return profitSoFar;
	}

	function tokenPrice() public view returns (uint256 price) {
		uint256 interestUnPaid;
		if (lastSettleTime_ != uint88(block.timestamp)) {
			(, interestUnPaid) = _getAllInterest();
		}

		return _tokenPrice(_totalAssetSupply(interestUnPaid));
	}

	function checkpointPrice(address _user) public view returns (uint256 price) {
		return checkpointPrices_[_user];
	}

	function marketLiquidity() public view returns (uint256) {
		uint256 totalSupply = _totalAssetSupply(0);
		uint256 totalBorrow = totalAssetBorrow();
		if (totalSupply > totalBorrow) {
			return totalSupply.sub(totalBorrow);
		}
	}

	function avgBorrowInterestRate() public view returns (uint256) {
		return _avgBorrowInterestRate(totalAssetBorrow());
	}

	// the minimum rate the next base protocol borrower will receive for variable-rate loans
	function borrowInterestRate() public view returns (uint256) {
		return _nextBorrowInterestRate(0);
	}

	function nextBorrowInterestRate(uint256 borrowAmount) public view returns (uint256) {
		return _nextBorrowInterestRate(borrowAmount);
	}

	// interest that lenders are currently receiving when supplying to the pool
	function supplyInterestRate() public view returns (uint256) {
		return totalSupplyInterestRate(_totalAssetSupply(0));
	}

	function nextSupplyInterestRate(uint256 supplyAmount) public view returns (uint256) {
		return totalSupplyInterestRate(_totalAssetSupply(0).add(supplyAmount));
	}

	function totalSupplyInterestRate(uint256 assetSupply) public view returns (uint256) {
		uint256 assetBorrow = totalAssetBorrow();
		if (assetBorrow != 0) {
			return _supplyInterestRate(assetBorrow, assetSupply);
		}
	}

	function totalAssetBorrow() public view returns (uint256) {
		return ProtocolLike(sovrynContractAddress).getTotalPrincipal(address(this), loanTokenAddress);
	}

	function totalAssetSupply() public view returns (uint256) {
		uint256 interestUnPaid;
		if (lastSettleTime_ != uint88(block.timestamp)) {
			(, interestUnPaid) = _getAllInterest();
		}

		return _totalAssetSupply(interestUnPaid);
	}

	/**
	 * @notice computes the maximum deposit amount under current market conditions
	 * @dev maxEscrowAmount = liquidity * (100 - interestForDuration) / 100
	 * @param leverageAmount the chosen leverage with 18 decimals
	 * */
	function getMaxEscrowAmount(uint256 leverageAmount) public view returns (uint256 maxEscrowAmount) {
		//mathematical imperfection. depending on liquidity we might be able to borrow more if utilization is below the kink level
		uint256 interestForDuration = maxScaleRate.mul(28).div(365);
		uint256 factor = uint256(10**20).sub(interestForDuration);
		uint256 maxLoanSize = marketLiquidity().mul(factor).div(10**20);
		maxEscrowAmount = maxLoanSize.mul(10**18).div(leverageAmount);
	}

	// returns the user's balance of underlying token
	function assetBalanceOf(address _owner) public view returns (uint256) {
		return balanceOf(_owner).mul(tokenPrice()).div(10**18);
	}

	function getEstimatedMarginDetails(
		uint256 leverageAmount,
		uint256 loanTokenSent,
		uint256 collateralTokenSent,
		address collateralTokenAddress // address(0) means ETH
	)
		public
		view
		returns (
			uint256 principal,
			uint256 collateral,
			uint256 interestRate
		)
	{
		if (collateralTokenAddress == address(0)) {
			collateralTokenAddress = wrbtcTokenAddress;
		}

		uint256 totalDeposit = _totalDeposit(collateralTokenAddress, collateralTokenSent, loanTokenSent);

		(principal, interestRate) = _getMarginBorrowAmountAndRate(leverageAmount, totalDeposit);
		if (principal > _underlyingBalance()) {
			return (0, 0, 0);
		}

		loanTokenSent = loanTokenSent.add(principal);

		collateral = ProtocolLike(sovrynContractAddress).getEstimatedMarginExposure(
			loanTokenAddress,
			collateralTokenAddress,
			loanTokenSent,
			collateralTokenSent,
			interestRate,
			principal
		);
	}

	function getDepositAmountForBorrow(
		uint256 borrowAmount,
		uint256 initialLoanDuration, // duration in seconds
		address collateralTokenAddress // address(0) means ETH
	) public view returns (uint256 depositAmount) {
		if (borrowAmount != 0) {
			(, , uint256 newBorrowAmount) = _getInterestRateAndBorrowAmount(borrowAmount, totalAssetSupply(), initialLoanDuration);

			if (newBorrowAmount <= _underlyingBalance()) {
				return
					ProtocolLike(sovrynContractAddress)
						.getRequiredCollateral(
						loanTokenAddress,
						collateralTokenAddress != address(0) ? collateralTokenAddress : wrbtcTokenAddress,
						newBorrowAmount,
						50 * 10**18, // initialMargin
						true // isTorqueLoan
					)
						.add(10); // some dust to compensate for rounding errors
			}
		}
	}

	function getBorrowAmountForDeposit(
		uint256 depositAmount,
		uint256 initialLoanDuration, // duration in seconds
		address collateralTokenAddress // address(0) means ETH
	) public view returns (uint256 borrowAmount) {
		if (depositAmount != 0) {
			borrowAmount = ProtocolLike(sovrynContractAddress).getBorrowAmount(
				loanTokenAddress,
				collateralTokenAddress != address(0) ? collateralTokenAddress : wrbtcTokenAddress,
				depositAmount,
				50 * 10**18, // initialMargin,
				true // isTorqueLoan
			);

			(, , borrowAmount) = _getInterestRateAndBorrowAmount(borrowAmount, totalAssetSupply(), initialLoanDuration);

			if (borrowAmount > _underlyingBalance()) {
				borrowAmount = 0;
			}
		}
	}

	/* Internal functions */

	function _mintToken(address receiver, uint256 depositAmount) internal returns (uint256 mintAmount) {
		require(depositAmount != 0, "17");

		_settleInterest();

		uint256 currentPrice = _tokenPrice(_totalAssetSupply(0));
		mintAmount = depositAmount.mul(10**18).div(currentPrice);

		if (msg.value == 0) {
			_safeTransferFrom(loanTokenAddress, msg.sender, address(this), depositAmount, "18");
		} else {
			IWrbtc(wrbtcTokenAddress).deposit.value(depositAmount)();
		}

		uint256 oldBalance = balances[receiver];
		_updateCheckpoints(
			receiver,
			oldBalance,
			_mint(receiver, mintAmount, depositAmount, currentPrice), // newBalance
			currentPrice
		);
	}

	function _burnToken(uint256 burnAmount) internal returns (uint256 loanAmountPaid) {
		require(burnAmount != 0, "19");

		if (burnAmount > balanceOf(msg.sender)) {
			burnAmount = balanceOf(msg.sender);
		}

		_settleInterest();

		uint256 currentPrice = _tokenPrice(_totalAssetSupply(0));

		uint256 loanAmountOwed = burnAmount.mul(currentPrice).div(10**18);
		uint256 loanAmountAvailableInContract = _underlyingBalance();

		loanAmountPaid = loanAmountOwed;
		require(loanAmountPaid <= loanAmountAvailableInContract, "37");

		uint256 oldBalance = balances[msg.sender];

		//this function does not only update the checkpoints but also the current profit of the user
		_updateCheckpoints(
			msg.sender,
			oldBalance,
			_burn(msg.sender, burnAmount, loanAmountPaid, currentPrice), // newBalance
			currentPrice
		);
	}

	function _settleInterest() internal {
		uint88 ts = uint88(block.timestamp);
		if (lastSettleTime_ != ts) {
			ProtocolLike(sovrynContractAddress).withdrawAccruedInterest(loanTokenAddress);

			lastSettleTime_ = ts;
		}
	}

	/**
	 * @dev computes what the deposit is worth in loan tokens using the swap rate
	 *      used for loan size computation
	 * @param collateralTokenAddress the address of the collateral token
	 * @param collateralTokenSent the number of collateral tokens provided the user
	 * @param loanTokenSent the number of loan tokens provided by the user
	 * @return the value of the deposit in loan tokens
	 * */
	function _totalDeposit(
		address collateralTokenAddress,
		uint256 collateralTokenSent,
		uint256 loanTokenSent
	) internal view returns (uint256 totalDeposit) {
		totalDeposit = loanTokenSent;

		if (collateralTokenSent != 0) {
			//get the oracle rate from collateral -> loan
			(uint256 collateralToLoanRate, uint256 collateralToLoanPrecision) =
				FeedsLike(ProtocolLike(sovrynContractAddress).priceFeeds()).queryRate(collateralTokenAddress, loanTokenAddress);
			require((collateralToLoanRate != 0) && (collateralToLoanPrecision != 0), "invalid exchange rate for the collateral token");

			//compute the loan token amount with the oracle rate
			uint256 loanTokenAmount = collateralTokenSent.mul(collateralToLoanRate).div(collateralToLoanPrecision);

			//see how many collateralTokens we would get if exchanging this amount of loan tokens to collateral tokens
			uint256 collateralTokenAmount =
				ProtocolLike(sovrynContractAddress).getSwapExpectedReturn(loanTokenAddress, collateralTokenAddress, loanTokenAmount);

			//probably not the same due to the price difference
			if (collateralTokenAmount != collateralTokenSent) {
				//scale the loan token amount accordingly, so we'll get the expected position size in the end
				loanTokenAmount = loanTokenAmount.mul(collateralTokenAmount).div(collateralTokenSent);
			}

			totalDeposit = loanTokenAmount.add(totalDeposit);
		}
	}

	function _getInterestRateAndBorrowAmount(
		uint256 borrowAmount,
		uint256 assetSupply,
		uint256 initialLoanDuration // duration in seconds
	)
		internal
		view
		returns (
			uint256 interestRate,
			uint256 interestInitialAmount,
			uint256 newBorrowAmount
		)
	{
		interestRate = _nextBorrowInterestRate2(borrowAmount, assetSupply);

		// newBorrowAmount = borrowAmount * 10^18 / (10^18 - interestRate * 7884000 * 10^18 / 31536000 / 10^20)
		newBorrowAmount = borrowAmount.mul(10**18).div(
			SafeMath.sub(
				10**18,
				interestRate.mul(initialLoanDuration).mul(10**18).div(31536000 * 10**20) // 365 * 86400 * 10**20
			)
		);

		interestInitialAmount = newBorrowAmount.sub(borrowAmount);
	}

	// returns newPrincipal
	function _borrowOrTrade(
		bytes32 loanId,
		uint256 withdrawAmount,
		uint256 leverageAmount,
		address collateralTokenAddress,
		address[4] memory sentAddresses,
		uint256[5] memory sentAmounts,
		bytes memory loanDataBytes
	) internal returns (uint256, uint256) {
		_checkPause();
		require(
			sentAmounts[1] <= _underlyingBalance() && // newPrincipal (borrowed amount + fees)
				sentAddresses[1] != address(0), // borrower
			"24"
		);

		if (sentAddresses[2] == address(0)) {
			sentAddresses[2] = sentAddresses[1]; // receiver = borrower
		}

		// handle transfers prior to adding newPrincipal to loanTokenSent
		uint256 msgValue = _verifyTransfers(collateralTokenAddress, sentAddresses, sentAmounts, withdrawAmount);

		// adding the loan token portion from the lender to loanTokenSent
		// (add the loan to the loan tokens sent from the user)
		sentAmounts[3] = sentAmounts[3].add(sentAmounts[1]); // newPrincipal

		if (withdrawAmount != 0) {
			// withdrawAmount already sent to the borrower, so we aren't sending it to the protocol
			sentAmounts[3] = sentAmounts[3].sub(withdrawAmount);
		}

		bool withdrawAmountExist = false; // Default is false, but added just as to make sure.

		if (withdrawAmount != 0) {
			withdrawAmountExist = true;
		}

		bytes32 loanParamsId = loanParamsIds[uint256(keccak256(abi.encodePacked(collateralTokenAddress, withdrawAmountExist)))];
		// converting to initialMargin
		leverageAmount = SafeMath.div(10**38, leverageAmount);
		(sentAmounts[1], sentAmounts[4]) = ProtocolLike(sovrynContractAddress).borrowOrTradeFromPool.value(msgValue)( // newPrincipal, newCollateral
			loanParamsId,
			loanId,
			withdrawAmountExist,
			leverageAmount, // initialMargin
			sentAddresses,
			sentAmounts,
			loanDataBytes
		);
		require(sentAmounts[1] != 0, "25");

		//REFACTOR: move to a general interface: ProtocolSettingsLike?
		ProtocolAffiliatesInterface(sovrynContractAddress).setUserNotFirstTradeFlag(sentAddresses[1]);

		return (sentAmounts[1], sentAmounts[4]); // newPrincipal, newCollateral
	}

	// sentAddresses[0]: lender
	// sentAddresses[1]: borrower/trader
	// sentAddresses[2]: receiver
	// sentAddresses[3]: manager
	// sentAmounts[0]: interestRate
	// sentAmounts[1]: newPrincipal
	// sentAmounts[2]: interestInitialAmount
	// sentAmounts[3]: loanTokenSent
	// sentAmounts[4]: collateralTokenSent
	function _verifyTransfers(
		address collateralTokenAddress,
		address[4] memory sentAddresses,
		uint256[5] memory sentAmounts,
		uint256 withdrawalAmount
	) internal returns (uint256 msgValue) {
		address _wrbtcToken = wrbtcTokenAddress;
		address _loanTokenAddress = loanTokenAddress;
		address receiver = sentAddresses[2];
		uint256 newPrincipal = sentAmounts[1];
		uint256 loanTokenSent = sentAmounts[3];
		uint256 collateralTokenSent = sentAmounts[4];

		require(_loanTokenAddress != collateralTokenAddress, "26");

		msgValue = msg.value;

		if (withdrawalAmount != 0) {
			// withdrawOnOpen == true
			_safeTransfer(_loanTokenAddress, receiver, withdrawalAmount, "");
			if (newPrincipal > withdrawalAmount) {
				_safeTransfer(_loanTokenAddress, sovrynContractAddress, newPrincipal - withdrawalAmount, "");
			}
		} else {
			_safeTransfer(_loanTokenAddress, sovrynContractAddress, newPrincipal, "27");
		}
		//this is a critical piece of code!
		//wEth are supposed to be held by the contract itself, while other tokens are being transfered from the sender directly
		if (collateralTokenSent != 0) {
			if (collateralTokenAddress == _wrbtcToken && msgValue != 0 && msgValue >= collateralTokenSent) {
				IWrbtc(_wrbtcToken).deposit.value(collateralTokenSent)();
				_safeTransfer(collateralTokenAddress, sovrynContractAddress, collateralTokenSent, "28-a");
				msgValue -= collateralTokenSent;
			} else {
				_safeTransferFrom(collateralTokenAddress, msg.sender, sovrynContractAddress, collateralTokenSent, "28-b");
			}
		}

		if (loanTokenSent != 0) {
			_safeTransferFrom(_loanTokenAddress, msg.sender, sovrynContractAddress, loanTokenSent, "29");
		}
	}

	function _safeTransfer(
		address token,
		address to,
		uint256 amount,
		string memory errorMsg
	) internal {
		_callOptionalReturn(token, abi.encodeWithSelector(IERC20(token).transfer.selector, to, amount), errorMsg);
	}

	function _safeTransferFrom(
		address token,
		address from,
		address to,
		uint256 amount,
		string memory errorMsg
	) internal {
		_callOptionalReturn(token, abi.encodeWithSelector(IERC20(token).transferFrom.selector, from, to, amount), errorMsg);
	}

	function _callOptionalReturn(
		address token,
		bytes memory data,
		string memory errorMsg
	) internal {
		(bool success, bytes memory returndata) = token.call(data);
		require(success, errorMsg);

		if (returndata.length != 0) {
			require(abi.decode(returndata, (bool)), errorMsg);
		}
	}

	function _underlyingBalance() internal view returns (uint256) {
		return IERC20(loanTokenAddress).balanceOf(address(this));
	}

	/* Internal View functions */

	function _tokenPrice(uint256 assetSupply) internal view returns (uint256) {
		uint256 totalTokenSupply = totalSupply_;

		return totalTokenSupply != 0 ? assetSupply.mul(10**18).div(totalTokenSupply) : initialPrice;
	}

	function _avgBorrowInterestRate(uint256 assetBorrow) internal view returns (uint256) {
		if (assetBorrow != 0) {
			(uint256 interestOwedPerDay, ) = _getAllInterest();
			return interestOwedPerDay.mul(10**20).div(assetBorrow).mul(365);
		}
	}

	// next supply interest adjustment
	function _supplyInterestRate(uint256 assetBorrow, uint256 assetSupply) public view returns (uint256) {
		if (assetBorrow != 0 && assetSupply >= assetBorrow) {
			return
				_avgBorrowInterestRate(assetBorrow)
					.mul(_utilizationRate(assetBorrow, assetSupply))
					.mul(SafeMath.sub(10**20, ProtocolLike(sovrynContractAddress).lendingFeePercent()))
					.div(10**40);
		}
	}

	function _nextBorrowInterestRate(uint256 borrowAmount) internal view returns (uint256) {
		uint256 interestUnPaid;
		if (borrowAmount != 0) {
			if (lastSettleTime_ != uint88(block.timestamp)) {
				(, interestUnPaid) = _getAllInterest();
			}

			uint256 balance = _underlyingBalance().add(interestUnPaid);
			if (borrowAmount > balance) {
				borrowAmount = balance;
			}
		}

		return _nextBorrowInterestRate2(borrowAmount, _totalAssetSupply(interestUnPaid));
	}

	function _nextBorrowInterestRate2(uint256 newBorrowAmount, uint256 assetSupply) internal view returns (uint256 nextRate) {
		uint256 utilRate = _utilizationRate(totalAssetBorrow().add(newBorrowAmount), assetSupply);

		uint256 thisMinRate;
		uint256 thisMaxRate;
		uint256 thisBaseRate = baseRate;
		uint256 thisRateMultiplier = rateMultiplier;
		uint256 thisTargetLevel = targetLevel;
		uint256 thisKinkLevel = kinkLevel;
		uint256 thisMaxScaleRate = maxScaleRate;

		if (utilRate < thisTargetLevel) {
			// target targetLevel utilization when utilization is under targetLevel
			utilRate = thisTargetLevel;
		}

		if (utilRate > thisKinkLevel) {
			// scale rate proportionally up to 100%
			uint256 thisMaxRange = WEI_PERCENT_PRECISION - thisKinkLevel; // will not overflow

			utilRate -= thisKinkLevel;
			if (utilRate > thisMaxRange) utilRate = thisMaxRange;

			thisMaxRate = thisRateMultiplier.add(thisBaseRate).mul(thisKinkLevel).div(WEI_PERCENT_PRECISION);

			nextRate = utilRate.mul(SafeMath.sub(thisMaxScaleRate, thisMaxRate)).div(thisMaxRange).add(thisMaxRate);
		} else {
			nextRate = utilRate.mul(thisRateMultiplier).div(WEI_PERCENT_PRECISION).add(thisBaseRate);

			thisMinRate = thisBaseRate;
			thisMaxRate = thisRateMultiplier.add(thisBaseRate);

			if (nextRate < thisMinRate) nextRate = thisMinRate;
			else if (nextRate > thisMaxRate) nextRate = thisMaxRate;
		}
	}

	function _getAllInterest() internal view returns (uint256 interestOwedPerDay, uint256 interestUnPaid) {
		// interestPaid, interestPaidDate, interestOwedPerDay, interestUnPaid, interestFeePercent, principalTotal
		uint256 interestFeePercent;
		(, , interestOwedPerDay, interestUnPaid, interestFeePercent, ) = ProtocolLike(sovrynContractAddress).getLenderInterestData(
			address(this),
			loanTokenAddress
		);

		interestUnPaid = interestUnPaid.mul(SafeMath.sub(10**20, interestFeePercent)).div(10**20);
	}

	/**
	 * @notice computes the loan size and interest rate
	 * @param leverageAmount the leverage with 18 decimals
	 * @param depositAmount the amount the user deposited in underlying loan tokens
	 * */
	function _getMarginBorrowAmountAndRate(uint256 leverageAmount, uint256 depositAmount)
		internal
		view
		returns (uint256 borrowAmount, uint256 interestRate)
	{
		uint256 loanSizeBeforeInterest = depositAmount.mul(leverageAmount).div(10**18);
		//mathematical imperfection. we calculate the interest rate based on the loanSizeBeforeInterest, but
		//the actual borrowed amount will be bigger.
		interestRate = _nextBorrowInterestRate2(loanSizeBeforeInterest, _totalAssetSupply(0));
		// assumes that loan, collateral, and interest token are the same
		borrowAmount = _adjustLoanSize(interestRate, 28 days, loanSizeBeforeInterest);
	}

	function _totalAssetSupply(uint256 interestUnPaid) internal view returns (uint256 assetSupply) {
		if (totalSupply_ != 0) {
			uint256 assetsBalance = _flTotalAssetSupply; // temporary locked totalAssetSupply during a flash loan transaction
			if (assetsBalance == 0) {
				assetsBalance = _underlyingBalance().add(totalAssetBorrow());
			}

			return assetsBalance.add(interestUnPaid);
		}
	}

	/**
	 * used to read externally from the smart contract to see if a function is paused
	 * returns a bool
	 * */
	function checkPause(string memory funcId) public view returns (bool isPaused) {
		bytes4 sig = bytes4(keccak256(abi.encodePacked(funcId)));
		bytes32 slot = keccak256(abi.encodePacked(sig, uint256(0xd46a704bc285dbd6ff5ad3863506260b1df02812f4f857c8cc852317a6ac64f2)));
		assembly {
			isPaused := sload(slot)
		}
		return isPaused;
	}

	/**
	 * used for internal verification if the called function is paused.
	 * throws an exception in case it's not
	 * */
	function _checkPause() internal view {
		//keccak256("iToken_FunctionPause")
		bytes32 slot = keccak256(abi.encodePacked(msg.sig, uint256(0xd46a704bc285dbd6ff5ad3863506260b1df02812f4f857c8cc852317a6ac64f2)));
		bool isPaused;
		assembly {
			isPaused := sload(slot)
		}
		require(!isPaused, "unauthorized");
	}

	/**
	 * @notice adjusts the loan size to make sure the expected exposure remains after prepaying the interest
	 * @dev loanSizeWithInterest = loanSizeBeforeInterest * 100 / (100 - interestForDuration)
	 * @param interestRate the interest rate to pay on the position
	 * @param maxDuration the maximum duration of the position (until rollover)
	 * @param loanSizeBeforeInterest the loan size before interest is added
	 * */
	function _adjustLoanSize(
		uint256 interestRate,
		uint256 maxDuration,
		uint256 loanSizeBeforeInterest
	) internal pure returns (uint256 loanSizeWithInterest) {
		uint256 interestForDuration = interestRate.mul(maxDuration).div(365 days);
		uint256 divisor = uint256(10**20).sub(interestForDuration);
		loanSizeWithInterest = loanSizeBeforeInterest.mul(10**20).div(divisor);
	}

	function _utilizationRate(uint256 assetBorrow, uint256 assetSupply) internal pure returns (uint256) {
		if (assetBorrow != 0 && assetSupply != 0) {
			// U = total_borrow / total_supply
			return assetBorrow.mul(10**20).div(assetSupply);
		}
	}
}
