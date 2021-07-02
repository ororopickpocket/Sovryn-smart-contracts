/**
 * Copyright 2017-2021, bZeroX, LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0.
 */

pragma solidity 0.5.17;
pragma experimental ABIEncoderV2;

import "./LoanTokenSettingsLowerAdmin.sol";
import "./interfaces/ProtocolLike.sol";
import "./interfaces/FeedsLike.sol";
import "../../modules/interfaces/ProtocolAffiliatesInterface.sol";
import "../../farm/ILiquidityMining.sol";

/**
 * @title Loan Token Logic Standard contract.
 * @notice This contract code comes from bZx. bZx is a protocol for tokenized margin
 * trading and lending https://bzx.network similar to the dYdX protocol.
 *
 * Logic around loan tokens (iTokens) required to operate borrowing,
 * and margin trading financial processes.
 *
 * The user provides funds to the lending pool using the mint function and
 * withdraws funds from the lending pool using the burn function. Mint and
 * burn refer to minting and burning loan tokens. Loan tokens represent a
 * share of the pool and gather interest over time.
 *
 * Interest rates are determined by supply and demand. When a lender deposits
 * funds, the interest rates go down. When a trader borrows funds, the
 * interest rates go up. Fulcrum uses a simple linear interest rate formula
 * of the form y = mx + b. The interest rate starts at 1% when loans aren't
 * being utilized and scales up to 40% when all the funds in the loan pool
 * are being borrowed.
 *
 * The borrow rate is determined at the time of the loan and represents the
 * net contribution of each borrower. Each borrower's interest contribution
 * is determined by the utilization rate of the pool and is netted against
 * all prior borrows. This means that the total amount of interest flowing
 * into the lending pool is not directly changed by lenders entering or
 * exiting the pool. The entrance or exit of lenders only impacts how the
 * interest payments are split up.
 *
 * For example, if there are 2 lenders with equal holdings each earning
 * 5% APR, but one of the lenders leave, then the remaining lender will earn
 * 10% APR since the interest payments don't have to be split between two
 * individuals.
 * */
contract LoanTokenLogicStandard is LoanTokenSettingsLowerAdmin {
	using SafeMath for uint256;
	using SignedSafeMath for int256;

	/// DON'T ADD VARIABLES HERE, PLEASE

	/// @dev Used by flashBorrow function.
	uint256 public constant VERSION = 6;
	/// @dev Used by flashBorrow function.
	address internal constant arbitraryCaller = 0x000F400e6818158D541C3EBE45FE3AA0d47372FF;
	bytes32 internal constant iToken_ProfitSoFar = 0x37aa2b7d583612f016e4a4de4292cb015139b3d7762663d06a53964912ea2fb6; // keccak256("iToken_ProfitSoFar")

	/**
	 * @notice Fallback function is to react to receiving value (rBTC).
	 * */
	function() external {
		// Due to contract size issue, need to keep the error message to 32 bytes length / we remove the revert function
		// Remove revert function is fine as this fallback function is not payable, but the trade off is we cannot have the custom message for the fallback function error
		// revert("loan token-fallback not allowed");
	}

	/* Public functions */

	/**
	 * @notice Mint loan token wrapper.
	 * Adds a check before calling low level _mintToken function.
	 * The function retrieves the tokens from the message sender, so make sure
	 * to first approve the loan token contract to access your funds. This is
	 * done by calling approve(address spender, uint amount) on the ERC20
	 * token contract, where spender is the loan token contract address and
	 * amount is the amount to be deposited.
	 *
	 * @param receiver The account getting the minted tokens.
	 * @param depositAmount The amount of underlying tokens provided on the
	 *   loan. (Not the number of loan tokens to mint).
	 *
	 * @return The amount of loan tokens minted.
	 * */
	function mint(address receiver, uint256 depositAmount) external nonReentrant returns (uint256 mintAmount) {
		return _mintToken(receiver, depositAmount);
	}

	/**
	 * @notice Burn loan token wrapper.
	 * Adds a pay-out transfer after calling low level _burnToken function.
	 * In order to withdraw funds to the pool, call burn on the respective
	 * loan token contract. This will burn your loan tokens and send you the
	 * underlying token in exchange.
	 *
	 * @param receiver The account getting the minted tokens.
	 * @param burnAmount The amount of loan tokens to redeem.
	 *
	 * @return The amount of underlying tokens payed to lender.
	 * */
	function burn(address receiver, uint256 burnAmount) external nonReentrant returns (uint256 loanAmountPaid) {
		loanAmountPaid = _burnToken(burnAmount);

		//this needs to be here and not in _burnTokens because of the WRBTC implementation
		if (loanAmountPaid != 0) {
			_safeTransfer(loanTokenAddress, receiver, loanAmountPaid, "5");
		}
	}

	/*
    flashBorrow is disabled for the MVP, but is going to be added later.
    therefore, it needs to be revised
    
    function flashBorrow(
        uint256 borrowAmount,
        address borrower,
        address target,
        string calldata signature,
        bytes calldata data)
        external
        payable
        nonReentrant
        pausable(msg.sig)
        returns (bytes memory)
    {
        require(borrowAmount != 0, "38");

        _checkPause();

        _settleInterest();

        /// @dev Save before balances.
        uint256 beforeRbtcBalance = address(this).balance.sub(msg.value);
        uint256 beforeAssetsBalance = _underlyingBalance()
            .add(totalAssetBorrow());

        /// @dev Lock totalAssetSupply for duration of flash loan.
        _flTotalAssetSupply = beforeAssetsBalance;

        /// @dev Transfer assets to calling contract.
        _safeTransfer(loanTokenAddress, borrower, borrowAmount, "39");

		emit FlashBorrow(borrower, target, loanTokenAddress, borrowAmount);

        bytes memory callData;
        if (bytes(signature).length == 0) {
            callData = data;
        } else {
            callData = abi.encodePacked(bytes4(keccak256(bytes(signature))), data);
        }

        /// @dev Arbitrary call.
        (bool success, bytes memory returnData) = arbitraryCaller.call.value(msg.value)(
            abi.encodeWithSelector(
                0xde064e0d, /// sendCall(address,bytes)
                target,
                callData
            )
        );
        require(success, "call failed");

        /// @dev Unlock totalAssetSupply
        _flTotalAssetSupply = 0;

        /// @dev Verifies return of flash loan.
        require(
            address(this).balance >= beforeRbtcBalance &&
            _underlyingBalance()
                .add(totalAssetBorrow()) >= beforeAssetsBalance,
            "40"
        );

        return returnData;
    }
    */

	/**
	 * @notice Borrow funds from the pool.
	 * The underlying loan token may not be used as collateral.
	 *
	 * @param loanId The ID of the loan, 0 for a new loan.
	 * @param withdrawAmount The amount to be withdrawn (actually borrowed).
	 * @param initialLoanDuration The duration of the loan in seconds.
	 *   If the loan is not paid back until then, it'll need to be rolled over.
	 * @param collateralTokenSent The amount of collateral tokens provided by the user.
	 *   (150% of the withdrawn amount worth in collateral tokens).
	 * @param collateralTokenAddress The address of the token to be used as
	 *   collateral. Cannot be the loan token address.
	 * @param borrower The one paying for the collateral.
	 * @param receiver The one receiving the withdrawn amount.
	 *
	 * @return New principal and new collateral added to loan.
	 * */
	function borrow(
		bytes32 loanId, /// 0 if new loan.
		uint256 withdrawAmount,
		uint256 initialLoanDuration, /// Duration in seconds.
		uint256 collateralTokenSent, /// If 0, loanId must be provided; any rBTC sent must equal this value.
		address collateralTokenAddress, /// If address(0), this means rBTC and rBTC must be sent with the call or loanId must be provided.
		address borrower,
		address receiver,
		bytes memory /// loanDataBytes: arbitrary order data (for future use).
	)
		public
		payable
		nonReentrant /// Note: needs to be removed to allow flashloan use cases.
		returns (
			uint256,
			uint256 /// Returns new principal and new collateral added to loan.
		)
	{
		require(withdrawAmount != 0, "6");

		_checkPause();

		/// Temporary: limit transaction size.
		if (transactionLimit[collateralTokenAddress] > 0) require(collateralTokenSent <= transactionLimit[collateralTokenAddress]);

		require( (msg.value == 0 || msg.value == collateralTokenSent) && (collateralTokenSent != 0 || loanId != 0) && (collateralTokenAddress != address(0) || msg.value != 0 || loanId != 0) && (loanId == 0 || msg.sender == borrower), "7");

		/// @dev We have an issue regarding contract size code is too big. 1 of the solution is need to keep the error message 32 bytes length
		// Temporarily, we combine this require to the above, so can save the contract size code
		// require(collateralTokenSent != 0 || loanId != 0, "8");
		// require(collateralTokenAddress != address(0) || msg.value != 0 || loanId != 0, "9");

		/// @dev Ensure authorized use of existing loan.
		// require(loanId == 0 || msg.sender == borrower, "401 use of existing loan");

		if (collateralTokenAddress == address(0)) {
			collateralTokenAddress = wrbtcTokenAddress;
		}
		require(collateralTokenAddress != loanTokenAddress, "10");

		_settleInterest();

		address[4] memory sentAddresses;
		uint256[5] memory sentAmounts;

		sentAddresses[0] = address(this); /// The lender.
		sentAddresses[1] = borrower;
		sentAddresses[2] = receiver;
		/// sentAddresses[3] = address(0); /// The manager.

		sentAmounts[1] = withdrawAmount;

		/// interestRate, interestInitialAmount, borrowAmount (newBorrowAmount).
		(sentAmounts[0], sentAmounts[2], sentAmounts[1]) = _getInterestRateAndBorrowAmount(
			sentAmounts[1],
			_totalAssetSupply(0), /// Interest is settled above.
			initialLoanDuration
		);

		/// sentAmounts[3] = 0; /// loanTokenSent
		sentAmounts[4] = collateralTokenSent;

		return
			_borrowOrTrade(
				loanId,
				withdrawAmount,
				2 * 10**18, /// leverageAmount (translates to 150% margin for a Torque loan).
				collateralTokenAddress,
				sentAddresses,
				sentAmounts,
				"" /// loanDataBytes
			);
	}

	/**
	 * @notice Borrow and immediately get into a position.
	 *
	 * Trading on margin is used to increase an investor's buying power.
	 * Margin is the amount of money required to open a position, while
	 * leverage is the multiple of exposure to account equity.
	 *
	 * Leverage allows you to trade positions LARGER than the amount
	 * of money in your trading account. Leverage is expressed as a ratio.
	 *
	 * When trading on margin, investors first deposit some token that then
	 * serves as collateral for the loan, and then pay ongoing interest
	 * payments on the money they borrow.
	 *
	 * Margin trading = taking a loan and swapping it:
	 * In order to open a margin trade position,
	 *  1.- The user calls marginTrade on the loan token contract.
	 *  2.- The loan token contract provides the loan and sends it for processing
	 *    to the protocol proxy contract.
	 *  3.- The protocol proxy contract uses the module LoanOpening to create a
	 *    position and swaps the loan tokens to collateral tokens.
	 *  4.- The Sovryn Swap network looks up the correct converter and swaps the
	 *    tokens.
	 * If successful, the position is being held by the protocol proxy contract,
	 * which is why positions need to be closed at the protocol proxy contract.
	 *
	 * @param loanId The ID of the loan, 0 for a new loan.
	 * @param leverageAmount The multiple of exposure: 2x ... 5x. The leverage with 18 decimals.
	 * @param loanTokenSent The number of loan tokens provided by the user.
	 * @param collateralTokenSent The amount of collateral tokens provided by the user.
	 * @param collateralTokenAddress The token address of collateral.
	 * @param trader The account that performs this trade.
	 *
	 * @return New principal and new collateral added to trade.
	 * */
	function marginTrade(
		bytes32 loanId, /// 0 if new loan
		uint256 leverageAmount, /// Expected in x * 10**18 where x is the actual leverage (2, 3, 4, or 5).
		uint256 loanTokenSent,
		uint256 collateralTokenSent,
		address collateralTokenAddress,
		address trader,
		uint256 minReturn, // minimum position size in the collateral tokens
		bytes memory loanDataBytes /// Arbitrary order data.
	)
		public
		payable
		nonReentrant /// Note: needs to be removed to allow flashloan use cases.
		returns (
			uint256,
			uint256 /// Returns new principal and new collateral added to trade.
		)
	{
		_checkPause();

		checkPriceDivergence(leverageAmount, loanTokenSent, collateralTokenSent, collateralTokenAddress, minReturn);

		if (collateralTokenAddress == address(0)) {
			collateralTokenAddress = wrbtcTokenAddress;
		}

		require(collateralTokenAddress != loanTokenAddress, "11");

		/// @dev Ensure authorized use of existing loan.
		require(loanId == 0 || msg.sender == trader, "401 use of existing loan");

		/// Temporary: limit transaction size.
		if (transactionLimit[collateralTokenAddress] > 0) require(collateralTokenSent <= transactionLimit[collateralTokenAddress]);
		if (transactionLimit[loanTokenAddress] > 0) require(loanTokenSent <= transactionLimit[loanTokenAddress]);

		/// @dev Compute the worth of the total deposit in loan tokens.
		/// (loanTokenSent + convert(collateralTokenSent))
		/// No actual swap happening here.
		uint256 totalDeposit = _totalDeposit(collateralTokenAddress, collateralTokenSent, loanTokenSent);
		require(totalDeposit != 0, "12");

		address[4] memory sentAddresses;
		uint256[5] memory sentAmounts;

		sentAddresses[0] = address(this); /// The lender.
		sentAddresses[1] = trader;
		sentAddresses[2] = trader;
		/// sentAddresses[3] = address(0); /// The manager.

		/// sentAmounts[0] = 0; /// interestRate (found later).
		sentAmounts[1] = totalDeposit; /// Total amount of deposit.
		/// sentAmounts[2] = 0; /// interestInitialAmount (interest is calculated based on fixed-term loan).
		sentAmounts[3] = loanTokenSent;
		sentAmounts[4] = collateralTokenSent;

		_settleInterest();

		(sentAmounts[1], sentAmounts[0]) = _getMarginBorrowAmountAndRate( /// borrowAmount, interestRate
			leverageAmount,
			sentAmounts[1] /// depositAmount
		);

		return
			_borrowOrTrade(
				loanId,
				0, /// withdrawAmount
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
		uint256 minReturn, // minimum position size in the collateral tokens
		address affiliateReferrer, // the user was brought by the affiliate (referrer)
		bytes calldata loanDataBytes // arbitrary order data
	)
		external
		payable
		returns (
			uint256,
			uint256 // returns new principal and new collateral added to trade
		)
	{
		if (affiliateReferrer != address(0))
			ProtocolAffiliatesInterface(sovrynContractAddress).setAffiliatesReferrer(trader, affiliateReferrer);
		return
			marginTrade(
				loanId,
				leverageAmount,
				loanTokenSent,
				collateralTokenSent,
				collateralTokenAddress,
				trader,
				minReturn,
				loanDataBytes
			);
	}

	/**
	 * @notice Transfer tokens wrapper.
	 * Sets token owner the msg.sender.
	 * Sets maximun allowance uint256(-1) to ensure tokens are always transferred.
	 *
	 * @param _to The recipient of the tokens.
	 * @param _value The amount of tokens sent.
	 * @return Success true/false.
	 * */
	function transfer(address _to, uint256 _value) external returns (bool) {
		return _internalTransferFrom(msg.sender, _to, _value, uint256(-1));
	}

	/**
	 * @notice Moves `_value` loan tokens from `_from` to `_to` using the
	 * allowance mechanism. Calls internal _internalTransferFrom function.
	 *
	 * @return A boolean value indicating whether the operation succeeded.
	 */
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
				//allowed[_from][msg.sender]
				ProtocolLike(sovrynContractAddress).isLoanPool(msg.sender) ? uint256(-1) : allowed[_from][msg.sender]
			);
	}

	/**
	 * @notice Transfer tokens, low level.
	 * Checks allowance, updates sender and recipient balances
	 * and updates checkpoints too.
	 *
	 * @param _from The tokens' owner.
	 * @param _to The recipient of the tokens.
	 * @param _value The amount of tokens sent.
	 * @param _allowanceAmount The amount of tokens allowed to transfer.
	 *
	 * @return Success true/false.
	 * */
	function _internalTransferFrom(
		address _from,
		address _to,
		uint256 _value,
		uint256 _allowanceAmount
	) internal returns (bool) {
		if (_allowanceAmount != uint256(-1)) {
			allowed[_from][msg.sender] = _allowanceAmount.sub(_value, "14");
		}

		require(_to != address(0), "15");

		uint256 _balancesFrom = balances[_from];
		uint256 _balancesFromNew = _balancesFrom.sub(_value, "16");
		balances[_from] = _balancesFromNew;

		uint256 _balancesTo = balances[_to];
		uint256 _balancesToNew = _balancesTo.add(_value);
		balances[_to] = _balancesToNew;

		/// @dev Handle checkpoint update.
		uint256 _currentPrice = tokenPrice();

		//checkpoints are not being used by the smart contract logic itself, but just for external use (query the profit)
		//only update the checkpoints of a user if he's not depositing to / withdrawing from the lending pool
		if (_from != liquidityMiningAddress && _to != liquidityMiningAddress) {
			_updateCheckpoints(_from, _balancesFrom, _balancesFromNew, _currentPrice);
			_updateCheckpoints(_to, _balancesTo, _balancesToNew, _currentPrice);
		}

		emit Transfer(_from, _to, _value);
		return true;
	}

	/**
	 * @notice Update the user's checkpoint price and profit so far.
	 * In this loan token contract, whenever some tokens are minted or burned,
	 * the _updateCheckpoints() function is invoked to update the stats to
	 * reflect the balance changes.
	 *
	 * @param _user The user address.
	 * @param _oldBalance The user's previous balance.
	 * @param _newBalance The user's updated balance.
	 * @param _currentPrice The current loan token price.
	 * */
	function _updateCheckpoints(
		address _user,
		uint256 _oldBalance,
		uint256 _newBalance,
		uint256 _currentPrice
	) internal {
		/// @dev keccak256("iToken_ProfitSoFar")
		bytes32 slot = keccak256(abi.encodePacked(_user, iToken_ProfitSoFar));

		int256 _currentProfit;
		if (_newBalance == 0) {
			_currentPrice = 0;
		} else if (_oldBalance != 0) {
			_currentProfit = _profitOf(slot, _oldBalance, _currentPrice, checkpointPrices_[_user]);
		}

		assembly {
			sstore(slot, _currentProfit)
		}

		checkpointPrices_[_user] = _currentPrice;
	}

	/* Public View functions */

	/**
	 * @notice Wrapper for internal _profitOf low level function.
	 * @param user The user address.
	 * @return The profit of a user.
	 * */
	function profitOf(address user) external view returns (int256) {
		/// @dev keccak256("iToken_ProfitSoFar")
		bytes32 slot = keccak256(abi.encodePacked(user, iToken_ProfitSoFar));
		//TODO + LM balance
		return _profitOf(slot, balances[user], tokenPrice(), checkpointPrices_[user]);
	}

	/**
	 * @notice Profit calculation based on checkpoints of price.
	 * @param slot The user slot.
	 * @param _balance The user balance.
	 * @param _currentPrice The current price of the loan token.
	 * @param _checkpointPrice The price of the loan token on checkpoint.
	 * @return The profit of a user.
	 * */
	function _profitOf(
		bytes32 slot,
		uint256 _balance,
		uint256 _currentPrice,
		uint256 _checkpointPrice
	) internal view returns (int256 profitSoFar) {
		if (_checkpointPrice == 0) {
			return 0;
		}

		assembly {
			profitSoFar := sload(slot)
		}

		profitSoFar = int256(_currentPrice).sub(int256(_checkpointPrice)).mul(int256(_balance)).div(sWEI_PRECISION).add(profitSoFar);
	}

	/**
	 * @notice Loan token price calculation considering unpaid interests.
	 * @return The loan token price.
	 * */
	function tokenPrice() public view returns (uint256 price) {
		uint256 interestUnPaid;
		if (lastSettleTime_ != uint88(block.timestamp)) {
			(, interestUnPaid) = _getAllInterest();
		}

		return _tokenPrice(_totalAssetSupply(interestUnPaid));
	}

	/**
	 * @notice Getter for the price checkpoint mapping.
	 * @param _user The user account as the mapping index.
	 * @return The price on the checkpoint for this user.
	 * */
	function checkpointPrice(address _user) public view returns (uint256 price) {
		return checkpointPrices_[_user];
	}

	/**
	 * @notice Get current liquidity.
	 * A part of total funds supplied are borrowed. Liquidity = supply - borrow
	 * @return The market liquidity.
	 * */
	function marketLiquidity() public view returns (uint256) {
		uint256 totalSupply = _totalAssetSupply(0);
		uint256 totalBorrow = totalAssetBorrow();
		if (totalSupply > totalBorrow) {
			return totalSupply - totalBorrow;
		}
	}

	/**
	 * @notice Wrapper for average borrow interest.
	 * @return The average borrow interest.
	 * */
	function avgBorrowInterestRate() public view returns (uint256) {
		return _avgBorrowInterestRate(totalAssetBorrow());
	}

	/**
	 * @notice Get borrow interest rate.
	 * The minimum rate the next base protocol borrower will receive
	 * for variable-rate loans.
	 * @return The borrow interest rate.
	 * */
	function borrowInterestRate() public view returns (uint256) {
		return _nextBorrowInterestRate(0);
	}

	/**
	 * @notice Public wrapper for internal call.
	 * @param borrowAmount The amount of tokens to borrow.
	 * @return The next borrow interest rate.
	 * */
	function nextBorrowInterestRate(uint256 borrowAmount) public view returns (uint256) {
		return _nextBorrowInterestRate(borrowAmount);
	}

	/**
	 * @notice Get interest rate.
	 *
	 * @return Interest that lenders are currently receiving when supplying to
	 * the pool.
	 * */
	function supplyInterestRate() public view returns (uint256) {
		return totalSupplyInterestRate(_totalAssetSupply(0));
	}

	/**
	 * @notice Get interest rate w/ added supply.
	 * @param supplyAmount The amount of tokens supplied.
	 * @return Interest that lenders are currently receiving when supplying
	 * a given amount of tokens to the pool.
	 * */
	function nextSupplyInterestRate(uint256 supplyAmount) public view returns (uint256) {
		return totalSupplyInterestRate(_totalAssetSupply(0).add(supplyAmount));
	}

	/**
	 * @notice Get interest rate w/ added supply assets.
	 * @param assetSupply The amount of loan tokens supplied.
	 * @return Interest that lenders are currently receiving when supplying
	 * a given amount of loan tokens to the pool.
	 * */
	function totalSupplyInterestRate(uint256 assetSupply) public view returns (uint256) {
		uint256 assetBorrow = totalAssetBorrow();
		if (assetBorrow != 0) {
			return _supplyInterestRate(assetBorrow, assetSupply);
		}
	}

	/**
	 * @notice Get the total amount of loan tokens on debt.
	 * Calls protocol getTotalPrincipal function.
	 * In the context of borrowing, principal is the initial size of a loan.
	 * It can also be the amount still owed on a loan. If you take out a
	 * $50,000 mortgage, for example, the principal is $50,000. If you pay off
	 * $30,000, the principal balance now consists of the remaining $20,000.
	 *
	 * @return The total amount of loan tokens on debt.
	 * */
	function totalAssetBorrow() public view returns (uint256) {
		return ProtocolLike(sovrynContractAddress).getTotalPrincipal(address(this), loanTokenAddress);
	}

	/**
	 * @notice Get the total amount of loan tokens on supply.
	 * @dev Wrapper for internal _totalAssetSupply function.
	 * @return The total amount of loan tokens on supply.
	 * */
	function totalAssetSupply() public view returns (uint256) {
		uint256 interestUnPaid;
		if (lastSettleTime_ != uint88(block.timestamp)) {
			(, interestUnPaid) = _getAllInterest();
		}

		return _totalAssetSupply(interestUnPaid);
	}

	/**
	 * @notice Compute the maximum deposit amount under current market conditions.
	 * @dev maxEscrowAmount = liquidity * (100 - interestForDuration) / 100
	 * @param leverageAmount The chosen multiplier with 18 decimals.
	 * */
	function getMaxEscrowAmount(uint256 leverageAmount) public view returns (uint256 maxEscrowAmount) {
		/**
		 * @dev Mathematical imperfection: depending on liquidity we might be able
		 * to borrow more if utilization is below the kink level.
		 * */
		uint256 interestForDuration = maxScaleRate.mul(28).div(365);
		uint256 factor = uint256(10**20).sub(interestForDuration);
		uint256 maxLoanSize = marketLiquidity().mul(factor).div(10**20);
		maxEscrowAmount = maxLoanSize.mul(10**18).div(leverageAmount);
	}

	/**
	 * @notice Get loan token balance.
	 * @return The user's balance of underlying token.
	 * */
	function assetBalanceOf(address _owner) public view returns (uint256) {
		uint256 balanceOnLM = 0;
		if (liquidityMiningAddress != address(0)) {
			balanceOnLM = ILiquidityMining(liquidityMiningAddress).getUserPoolTokenBalance(address(this), _owner);
		}
		return balanceOf(_owner).add(balanceOnLM).mul(tokenPrice()).div(10**18);
	}

	/**
	 * @notice Get margin information on a trade.
	 *
	 * @param leverageAmount The multiple of exposure: 2x ... 5x. The leverage with 18 decimals.
	 * @param loanTokenSent The number of loan tokens provided by the user.
	 * @param collateralTokenSent The amount of collateral tokens provided by the user.
	 * @param collateralTokenAddress The token address of collateral.
	 *
	 * @return The principal, the collateral and the interestRate.
	 * */
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

	/**
	 * @notice Calculate the deposit required to a given borrow.
	 *
	 * The function for doing over-collateralized borrows against loan tokens
	 * expects a minimum amount of collateral be sent to satisfy collateral
	 * requirements of the loan, for borrow amount, interest rate, and
	 * initial loan duration. To determine appropriate values to pass to this
	 * function for a given loan, `getDepositAmountForBorrow` and
	 * 'getBorrowAmountForDeposit` are required.
	 *
	 * @param borrowAmount The amount of borrow.
	 * @param initialLoanDuration The duration of the loan.
	 * @param collateralTokenAddress The token address of collateral.
	 *
	 * @return The amount of deposit required.
	 * */
	function getDepositAmountForBorrow(
		uint256 borrowAmount,
		uint256 initialLoanDuration, /// Duration in seconds.
		address collateralTokenAddress /// address(0) means rBTC
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
						50 * 10**18, /// initialMargin
						true /// isTorqueLoan
					)
						.add(10); /// Some dust to compensate for rounding errors.
			}
		}
	}

	/**
	 * @notice Calculate the borrow allowed for a given deposit.
	 *
	 * The function for doing over-collateralized borrows against loan tokens
	 * expects a minimum amount of collateral be sent to satisfy collateral
	 * requirements of the loan, for borrow amount, interest rate, and
	 * initial loan duration. To determine appropriate values to pass to this
	 * function for a given loan, `getDepositAmountForBorrow` and
	 * 'getBorrowAmountForDeposit` are required.
	 *
	 * @param depositAmount The amount of deposit.
	 * @param initialLoanDuration The duration of the loan.
	 * @param collateralTokenAddress The token address of collateral.
	 *
	 * @return The amount of borrow allowed.
	 * */
	function getBorrowAmountForDeposit(
		uint256 depositAmount,
		uint256 initialLoanDuration, /// Duration in seconds.
		address collateralTokenAddress /// address(0) means rBTC
	) public view returns (uint256 borrowAmount) {
		if (depositAmount != 0) {
			borrowAmount = ProtocolLike(sovrynContractAddress).getBorrowAmount(
				loanTokenAddress,
				collateralTokenAddress != address(0) ? collateralTokenAddress : wrbtcTokenAddress,
				depositAmount,
				50 * 10**18, /// initialMargin,
				true /// isTorqueLoan
			);

			(, , borrowAmount) = _getInterestRateAndBorrowAmount(borrowAmount, totalAssetSupply(), initialLoanDuration);

			if (borrowAmount > _underlyingBalance()) {
				borrowAmount = 0;
			}
		}
	}

	function checkPriceDivergence(
		uint256 leverageAmount,
		uint256 loanTokenSent,
		uint256 collateralTokenSent,
		address collateralTokenAddress,
		uint256 minReturn
	) public view {
		(, uint256 estimatedCollateral, ) =
			getEstimatedMarginDetails(leverageAmount, loanTokenSent, collateralTokenSent, collateralTokenAddress);
		require(estimatedCollateral >= minReturn, "coll too low");
	}

	/* Internal functions */

	/**
	 * @notice transfers the underlying asset from the msg.sender and mints tokens for the receiver
	 * @param receiver the address of the iToken receiver
	 * @param depositAmount the amount of underlying assets to be deposited
	 * @return the amount of iTokens issued
	 */
	function _mintToken(address receiver, uint256 depositAmount) internal returns (uint256 mintAmount) {
		uint256 currentPrice;

		//calculate amount to mint and transfer the underlying asset
		(mintAmount, currentPrice) = _prepareMinting(depositAmount);

		//compute balances needed for checkpoint update, considering that the user might have a pool token balance
		//on the liquidity mining contract
		uint256 balanceOnLM = 0;
		if (liquidityMiningAddress != address(0))
			balanceOnLM = ILiquidityMining(liquidityMiningAddress).getUserPoolTokenBalance(address(this), receiver);
		uint256 oldBalance = balances[receiver].add(balanceOnLM);
		uint256 newBalance = oldBalance.add(mintAmount);

		//mint the tokens to the receiver
		_mint(receiver, mintAmount, depositAmount, currentPrice);

		//update the checkpoint of the receiver
		_updateCheckpoints(receiver, oldBalance, newBalance, currentPrice);
	}

	/**
	 * calculates the amount of tokens to mint and transfers the underlying asset to this contract
	 * @param depositAmount the amount of the underyling asset deposited
	 * @return the amount to be minted
	 */
	function _prepareMinting(uint256 depositAmount) internal returns (uint256 mintAmount, uint256 currentPrice) {
		require(depositAmount != 0, "17");

		_settleInterest();

		currentPrice = _tokenPrice(_totalAssetSupply(0));
		mintAmount = depositAmount.mul(10**18).div(currentPrice);

		if (msg.value == 0) {
			_safeTransferFrom(loanTokenAddress, msg.sender, address(this), depositAmount, "18");
		} else {
			IWrbtc(wrbtcTokenAddress).deposit.value(depositAmount)();
		}
	}

	/**
	 * @notice A wrapper for AdvancedToken::_burn
	 *
	 * @param burnAmount The amount of loan tokens to redeem.
	 *
	 * @return The amount of underlying tokens payed to lender.
	 * */
	function _burnToken(uint256 burnAmount) internal returns (uint256 loanAmountPaid) {
		require(burnAmount != 0, "19");

		if (burnAmount > balanceOf(msg.sender)) {
			require(burnAmount == uint256(-1), "32");
			burnAmount = balanceOf(msg.sender);
		}

		_settleInterest();

		uint256 currentPrice = _tokenPrice(_totalAssetSupply(0));

		uint256 loanAmountOwed = burnAmount.mul(currentPrice).div(10**18);
		uint256 loanAmountAvailableInContract = _underlyingBalance();

		loanAmountPaid = loanAmountOwed;
		require(loanAmountPaid <= loanAmountAvailableInContract, "37");

		//compute balances needed for checkpoint update, considering that the user might have a pool token balance
		//on the liquidity mining contract
		uint256 balanceOnLM = 0;
		if (liquidityMiningAddress != address(0))
			balanceOnLM = ILiquidityMining(liquidityMiningAddress).getUserPoolTokenBalance(address(this), msg.sender);
		uint256 oldBalance = balances[msg.sender].add(balanceOnLM);
		uint256 newBalance = oldBalance.sub(burnAmount);

		_burn(msg.sender, burnAmount, loanAmountPaid, currentPrice);

		//this function does not only update the checkpoints but also the current profit of the user
		//all for external use only
		_updateCheckpoints(msg.sender, oldBalance, newBalance, currentPrice);
	}

	/**
	 * @notice Withdraw loan token interests from protocol.
	 * This function only operates once per block.
	 * It asks protocol to withdraw accrued interests for the loan token.
	 *
	 * @dev Internal sync required on every loan trade before starting.
	 * */
	function _settleInterest() internal {
		uint88 ts = uint88(block.timestamp);
		if (lastSettleTime_ != ts) {
			ProtocolLike(sovrynContractAddress).withdrawAccruedInterest(loanTokenAddress);

			lastSettleTime_ = ts;
		}
	}

	/**
	 * @notice Compute what the deposit is worth in loan tokens using the swap rate
	 *      used for loan size computation.
	 *
	 * @param collateralTokenAddress The token address of the collateral.
	 * @param collateralTokenSent The amount of collateral tokens provided by the user.
	 * @param loanTokenSent The number of loan tokens provided by the user.
	 *
	 * @return The value of the deposit in loan tokens.
	 * */
	function _totalDeposit(
		address collateralTokenAddress,
		uint256 collateralTokenSent,
		uint256 loanTokenSent
	) internal view returns (uint256 totalDeposit) {
		totalDeposit = loanTokenSent;

		if (collateralTokenSent != 0) {
			/// @dev Get the oracle rate from collateral -> loan
			(uint256 collateralToLoanRate, uint256 collateralToLoanPrecision) =
				FeedsLike(ProtocolLike(sovrynContractAddress).priceFeeds()).queryRate(collateralTokenAddress, loanTokenAddress);
			require((collateralToLoanRate != 0) && (collateralToLoanPrecision != 0), "invalid rate collateral token");

			/// @dev Compute the loan token amount with the oracle rate.
			uint256 loanTokenAmount = collateralTokenSent.mul(collateralToLoanRate).div(collateralToLoanPrecision);

			/// @dev See how many collateralTokens we would get if exchanging this amount of loan tokens to collateral tokens.
			uint256 collateralTokenAmount =
				ProtocolLike(sovrynContractAddress).getSwapExpectedReturn(loanTokenAddress, collateralTokenAddress, loanTokenAmount);

			/// @dev Probably not the same due to the price difference.
			if (collateralTokenAmount != collateralTokenSent) {
				//scale the loan token amount accordingly, so we'll get the expected position size in the end
				loanTokenAmount = loanTokenAmount.mul(collateralTokenAmount).div(collateralTokenSent);
			}

			totalDeposit = loanTokenAmount.add(totalDeposit);
		}
	}

	/**
	 * @notice Compute interest rate and other loan parameters.
	 *
	 * @param borrowAmount The amount of tokens to borrow.
	 * @param assetSupply The amount of loan tokens supplied.
	 * @param initialLoanDuration The duration of the loan in seconds.
	 *   If the loan is not paid back until then, it'll need to be rolled over.
	 *
	 * @return The interest rate, the interest calculated based on fixed-term
	 *   loan, and the new borrow amount.
	 * */
	function _getInterestRateAndBorrowAmount(
		uint256 borrowAmount,
		uint256 assetSupply,
		uint256 initialLoanDuration /// Duration in seconds.
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

		/// newBorrowAmount = borrowAmount * 10^18 / (10^18 - interestRate * 7884000 * 10^18 / 31536000 / 10^20)
		newBorrowAmount = borrowAmount.mul(10**18).div(
			SafeMath.sub(
				10**18,
				interestRate.mul(initialLoanDuration).mul(10**18).div(31536000 * 10**20) /// 365 * 86400 * 10**20
			)
		);

		interestInitialAmount = newBorrowAmount.sub(borrowAmount);
	}

	/**
	 * @notice Compute principal and collateral.
	 *
	 * @param loanId The ID of the loan, 0 for a new loan.
	 * @param withdrawAmount The amount to be withdrawn (actually borrowed).
	 * @param leverageAmount The multiple of exposure: 2x ... 5x. The leverage
	 *   with 18 decimals.
	 * @param collateralTokenAddress  The address of the token to be used as
	 *   collateral. Cannot be the loan token address.
	 * @param sentAddresses The addresses to send tokens: lender, borrower,
	 *   receiver and manager.
	 * @param sentAmounts The amounts to send to each address.
	 * @param loanDataBytes Additional loan data (not in use for token swaps).
	 *
	 * @return The new principal and the new collateral. Principal is the
	 *   complete borrowed amount (in loan tokens). Collateral is the complete
	 *   position size (loan + margin) (in collateral tokens).
	 * */
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
			sentAmounts[1] <= _underlyingBalance() && /// newPrincipal (borrowed amount + fees)
				sentAddresses[1] != address(0), /// The borrower.
			"24"
		);

		if (sentAddresses[2] == address(0)) {
			sentAddresses[2] = sentAddresses[1]; /// The receiver = the borrower.
		}

		/// @dev Handle transfers prior to adding newPrincipal to loanTokenSent
		uint256 msgValue = _verifyTransfers(collateralTokenAddress, sentAddresses, sentAmounts, withdrawAmount);

		/**
		 * @dev Adding the loan token portion from the lender to loanTokenSent
		 * (add the loan to the loan tokens sent from the user).
		 * */
		sentAmounts[3] = sentAmounts[3].add(sentAmounts[1]); /// newPrincipal

		if (withdrawAmount != 0) {
			/// @dev withdrawAmount already sent to the borrower, so we aren't sending it to the protocol.
			sentAmounts[3] = sentAmounts[3].sub(withdrawAmount);
		}

		bool withdrawAmountExist = false; /// Default is false, but added just as to make sure.

		if (withdrawAmount != 0) {
			withdrawAmountExist = true;
		}

		bytes32 loanParamsId = loanParamsIds[uint256(keccak256(abi.encodePacked(collateralTokenAddress, withdrawAmountExist)))];

		/// @dev Converting to initialMargin
		leverageAmount = SafeMath.div(10**38, leverageAmount);
		(sentAmounts[1], sentAmounts[4]) = ProtocolLike(sovrynContractAddress).borrowOrTradeFromPool.value(msgValue)( /// newPrincipal, newCollateral
			loanParamsId,
			loanId,
			withdrawAmountExist,
			leverageAmount, /// initialMargin
			sentAddresses,
			sentAmounts,
			loanDataBytes
		);
		require(sentAmounts[1] != 0, "25");

		//REFACTOR: move to a general interface: ProtocolSettingsLike?
		ProtocolAffiliatesInterface(sovrynContractAddress).setUserNotFirstTradeFlag(sentAddresses[1]);

		return (sentAmounts[1], sentAmounts[4]); // newPrincipal, newCollateral
	}

	/// sentAddresses[0]: lender
	/// sentAddresses[1]: borrower
	/// sentAddresses[2]: receiver
	/// sentAddresses[3]: manager
	/// sentAmounts[0]: interestRate
	/// sentAmounts[1]: newPrincipal
	/// sentAmounts[2]: interestInitialAmount
	/// sentAmounts[3]: loanTokenSent
	/// sentAmounts[4]: collateralTokenSent
	/**
	 * @notice .
	 *
	 * @param collateralTokenAddress The address of the token to be used as
	 *   collateral. Cannot be the loan token address.
	 * @param sentAddresses The addresses to send tokens: lender, borrower,
	 *   receiver and manager.
	 * @param sentAmounts The amounts to send to each address.
	 * @param withdrawalAmount The amount of tokens to withdraw.
	 *
	 * @return msgValue The amount of rBTC sent minus the collateral on tokens.
	 * */
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
			/// withdrawOnOpen == true
			_safeTransfer(_loanTokenAddress, receiver, withdrawalAmount, "");
			if (newPrincipal > withdrawalAmount) {
				_safeTransfer(_loanTokenAddress, sovrynContractAddress, newPrincipal - withdrawalAmount, "");
			}
		} else {
			_safeTransfer(_loanTokenAddress, sovrynContractAddress, newPrincipal, "27");
		}
		/**
		 * This is a critical piece of code!
		 * rBTC are supposed to be held by the contract itself, while other tokens are being transfered from the sender directly.
		 * */
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

	/**
	 * @notice Execute the ERC20 token's `transfer` function and reverts
	 * upon failure the main purpose of this function is to prevent a non
	 * standard ERC20 token from failing silently.
	 *
	 * @dev Wrappers around ERC20 operations that throw on failure (when the
	 * token contract returns false). Tokens that return no value (and instead
	 * revert or throw on failure) are also supported, non-reverting calls are
	 * assumed to be successful.
	 *
	 * @param token The ERC20 token address.
	 * @param to The target address.
	 * @param amount The transfer amount.
	 * @param errorMsg The error message on failure.
	 */
	function _safeTransfer(
		address token,
		address to,
		uint256 amount,
		string memory errorMsg
	) internal {
		_callOptionalReturn(token, abi.encodeWithSelector(IERC20(token).transfer.selector, to, amount), errorMsg);
	}

	/**
	 * @notice Execute the ERC20 token's `transferFrom` function and reverts
	 * upon failure the main purpose of this function is to prevent a non
	 * standard ERC20 token from failing silently.
	 *
	 * @dev Wrappers around ERC20 operations that throw on failure (when the
	 * token contract returns false). Tokens that return no value (and instead
	 * revert or throw on failure) are also supported, non-reverting calls are
	 * assumed to be successful.
	 *
	 * @param token The ERC20 token address.
	 * @param from The source address.
	 * @param to The target address.
	 * @param amount The transfer amount.
	 * @param errorMsg The error message on failure.
	 */
	function _safeTransferFrom(
		address token,
		address from,
		address to,
		uint256 amount,
		string memory errorMsg
	) internal {
		_callOptionalReturn(token, abi.encodeWithSelector(IERC20(token).transferFrom.selector, from, to, amount), errorMsg);
	}

	/**
	 * @notice Imitate a Solidity high-level call (i.e. a regular function
	 * call to a contract), relaxing the requirement on the return value:
	 * the return value is optional (but if data is returned, it must not be
	 * false).
	 *
	 * @param token The token targeted by the call.
	 * @param data The call data (encoded using abi.encode or one of its variants).
	 * @param errorMsg The error message on failure.
	 * */
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

	/**
	 * @notice Get the loan contract balance.
	 * @return The balance of the loan token for this contract.
	 * */
	function _underlyingBalance() internal view returns (uint256) {
		return IERC20(loanTokenAddress).balanceOf(address(this));
	}

	/* Internal View functions */

	/**
	 * @notice Compute the token price.
	 * @param assetSupply The amount of loan tokens supplied.
	 * @return The token price.
	 * */
	function _tokenPrice(uint256 assetSupply) internal view returns (uint256) {
		uint256 totalTokenSupply = totalSupply_;

		return totalTokenSupply != 0 ? assetSupply.mul(10**18).div(totalTokenSupply) : initialPrice;
	}

	/**
	 * @notice Compute the average borrow interest rate.
	 * @param assetBorrow The amount of loan tokens on debt.
	 * @return The average borrow interest rate.
	 * */
	function _avgBorrowInterestRate(uint256 assetBorrow) internal view returns (uint256) {
		if (assetBorrow != 0) {
			(uint256 interestOwedPerDay, ) = _getAllInterest();
			return interestOwedPerDay.mul(10**20).mul(365).div(assetBorrow);
		}
	}

	/**
	 * @notice Compute the next supply interest adjustment.
	 * @param assetBorrow The amount of loan tokens on debt.
	 * @param assetSupply The amount of loan tokens supplied.
	 * @return The next supply interest adjustment.
	 * */
	function _supplyInterestRate(uint256 assetBorrow, uint256 assetSupply) public view returns (uint256) {
		if (assetBorrow != 0 && assetSupply >= assetBorrow) {
			return
				_avgBorrowInterestRate(assetBorrow)
					.mul(_utilizationRate(assetBorrow, assetSupply))
					.mul(SafeMath.sub(10**20, ProtocolLike(sovrynContractAddress).lendingFeePercent()))
					.div(10**40);
		}
	}

	/**
	 * @notice Compute the next borrow interest adjustment.
	 * @param borrowAmount The amount of tokens to borrow.
	 * @return The next borrow interest adjustment.
	 * */
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

	/**
	 * @notice Compute the next borrow interest adjustment under target-kink
	 * level analysis.
	 *
	 * The "kink" in the cDAI interest rate model reflects the utilization rate
	 * at which the slope of the interest rate goes from "gradual" to "steep".
	 * That is, below this utilization rate, the slope of the interest rate
	 * curve is gradual. Above this utilization rate, it is steep.
	 *
	 * Because of this dynamic between the interest rate curves before and
	 * after the "kink", the "kink" can be thought of as the target utilization
	 * rate. Above that rate, it quickly becomes expensive to borrow (and
	 * commensurately lucrative for suppliers).
	 *
	 * @param newBorrowAmount The new amount of tokens to borrow.
	 * @param assetSupply The amount of loan tokens supplied.
	 * @return The next borrow interest adjustment.
	 * */
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
			/// @dev Scale rate proportionally up to 100%
			uint256 thisMaxRange = WEI_PERCENT_PRECISION - thisKinkLevel; /// Will not overflow.

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

	/**
	 * @notice Get two kind of interests: owed per day and yet to be paid.
	 * @return interestOwedPerDay The interest per day.
	 * @return interestUnPaid The interest not yet paid.
	 * */
	function _getAllInterest() internal view returns (uint256 interestOwedPerDay, uint256 interestUnPaid) {
		/// interestPaid, interestPaidDate, interestOwedPerDay, interestUnPaid, interestFeePercent, principalTotal
		uint256 interestFeePercent;
		(, , interestOwedPerDay, interestUnPaid, interestFeePercent, ) = ProtocolLike(sovrynContractAddress).getLenderInterestData(
			address(this),
			loanTokenAddress
		);

		interestUnPaid = interestUnPaid.mul(SafeMath.sub(10**20, interestFeePercent)).div(10**20);
	}

	/**
	 * @notice Compute the loan size and interest rate.
	 * @param leverageAmount The leverage with 18 decimals.
	 * @param depositAmount The amount the user deposited in underlying loan tokens.
	 * @return borrowAmount The amount of tokens to borrow.
	 * @return interestRate The interest rate to pay on the position.
	 * */
	function _getMarginBorrowAmountAndRate(uint256 leverageAmount, uint256 depositAmount)
		internal
		view
		returns (uint256 borrowAmount, uint256 interestRate)
	{
		uint256 loanSizeBeforeInterest = depositAmount.mul(leverageAmount).div(10**18);
		/**
		 * @dev Mathematical imperfection. we calculate the interest rate based on
		 * the loanSizeBeforeInterest, but the actual borrowed amount will be bigger.
		 * */
		interestRate = _nextBorrowInterestRate2(loanSizeBeforeInterest, _totalAssetSupply(0));
		/// @dev Assumes that loan, collateral, and interest token are the same.
		borrowAmount = _adjustLoanSize(interestRate, 28 days, loanSizeBeforeInterest);
	}

	/**
	 * @notice Compute the total amount of loan tokens on supply.
	 * @param interestUnPaid The interest not yet paid.
	 * @return assetSupply The total amount of loan tokens on supply.
	 * */
	function _totalAssetSupply(uint256 interestUnPaid) internal view returns (uint256 assetSupply) {
		if (totalSupply_ != 0) {
			uint256 assetsBalance = _flTotalAssetSupply; /// Temporary locked totalAssetSupply during a flash loan transaction.
			if (assetsBalance == 0) {
				assetsBalance = _underlyingBalance().add(totalAssetBorrow());
			}

			return assetsBalance.add(interestUnPaid);
		}
	}

	/**
	 * @notice Check whether a function is paused.
	 *
	 * @dev Used to read externally from the smart contract to see if a
	 *   function is paused.
	 *
	 * @param funcId The function ID, the selector.
	 *
	 * @return isPaused Whether the function is paused: true or false.
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
	 * @notice Make sure call is not paused.
	 * @dev Used for internal verification if the called function is paused.
	 *   It throws an exception in case it's not.
	 * */
	function _checkPause() internal view {
		/// keccak256("iToken_FunctionPause")
		bytes32 slot = keccak256(abi.encodePacked(msg.sig, uint256(0xd46a704bc285dbd6ff5ad3863506260b1df02812f4f857c8cc852317a6ac64f2)));
		bool isPaused;
		assembly {
			isPaused := sload(slot)
		}
		require(!isPaused, "unauthorized");
	}

	/**
	 * @notice Adjusts the loan size to make sure the expected exposure remains after prepaying the interest.
	 * @dev loanSizeWithInterest = loanSizeBeforeInterest * 100 / (100 - interestForDuration)
	 * @param interestRate The interest rate to pay on the position.
	 * @param maxDuration The maximum duration of the position (until rollover).
	 * @param loanSizeBeforeInterest The loan size before interest is added.
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

	/**
	 * @notice Calculate the utilization rate.
	 * @dev Utilization rate = assetBorrow / assetSupply
	 * @param assetBorrow The amount of loan tokens on debt.
	 * @param assetSupply The amount of loan tokens supplied.
	 * @return The utilization rate.
	 * */
	function _utilizationRate(uint256 assetBorrow, uint256 assetSupply) internal pure returns (uint256) {
		if (assetBorrow != 0 && assetSupply != 0) {
			/// U = total_borrow / total_supply
			return assetBorrow.mul(10**20).div(assetSupply);
		}
	}

	/**
	 * @notice sets the liquidity mining contract address
	 * @param LMAddress the address of the liquidity mining contract
	 */
	function setLiquidityMiningAddress(address LMAddress) external onlyOwner {
		liquidityMiningAddress = LMAddress;
	}

	function _mintWithLM(address receiver, uint256 depositAmount) internal returns (uint256 minted) {
		//mint the tokens for the receiver
		minted = _mintToken(receiver, depositAmount);

		//transfer the tokens from the receiver to the LM address
		_internalTransferFrom(receiver, liquidityMiningAddress, minted, minted);

		//inform the LM mining contract
		ILiquidityMining(liquidityMiningAddress).onTokensDeposited(receiver, minted);
	}

	function _burnFromLM(uint256 burnAmount) internal returns (uint256) {
		uint256 balanceOnLM = ILiquidityMining(liquidityMiningAddress).getUserPoolTokenBalance(address(this), msg.sender);
		require(balanceOnLM.add(balanceOf(msg.sender)) >= burnAmount, "invalid balance"); // invalid balance

		if (balanceOnLM > 0) {
			//withdraw pool tokens and LM rewards to the passed address
			if (balanceOnLM < burnAmount) {
				ILiquidityMining(liquidityMiningAddress).withdraw(address(this), balanceOnLM, msg.sender);
			} else {
				ILiquidityMining(liquidityMiningAddress).withdraw(address(this), burnAmount, msg.sender);
			}
		}
		//burn the tokens of the msg.sender
		return _burnToken(burnAmount);
	}
}
