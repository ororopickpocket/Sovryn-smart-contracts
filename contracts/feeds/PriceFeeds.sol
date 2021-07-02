/**
 * Copyright 2017-2021, bZeroX, LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0.
 */

pragma solidity 0.5.17;

import "../openzeppelin/SafeMath.sol";
import "../openzeppelin/Ownable.sol";
import "../interfaces/IERC20.sol";
import "./PriceFeedsConstants.sol";

interface IPriceFeedsExt {
	function latestAnswer() external view returns (uint256);
}

/**
 * @title The Price Feeds contract.
 *
 * @notice This contract code comes from bZx. bZx is a protocol for tokenized
 * margin trading and lending https://bzx.network similar to the dYdX protocol.
 *
 * This contract queries the price feeds contracts where
 * oracles updates token prices computing relative token prices.
 * And besides it includes some calculations about loans such as
 * drawdown, margin and collateral.
 * */
contract PriceFeeds is Constants, Ownable {
	using SafeMath for uint256;

	/* Events */

	event GlobalPricingPaused(address indexed sender, bool indexed isPaused);

	/* Storage */

	/// Mapping of PriceFeedsExt instances.
	/// token => pricefeed
	mapping(address => IPriceFeedsExt) public pricesFeeds;

	/// Decimals of supported tokens.
	mapping(address => uint256) public decimals;

	/// Value on rBTC weis for the protocol token.
	uint256 public protocolTokenEthPrice = 0.0002 ether;

	/// Flag to pause pricings.
	bool public globalPricingPaused = false;

	/* Functions */

	/**
	 * @notice Contract deployment requires 3 parameters.
	 *
	 * @param _wrbtcTokenAddress The address of the wrapped wrBTC token.
	 * @param _protocolTokenAddress The address of the protocol token.
	 * @param _baseTokenAddress The address of the base token.
	 * */
	constructor(
		address _wrbtcTokenAddress,
		address _protocolTokenAddress,
		address _baseTokenAddress
	) public {
		/// Set decimals for this token.
		decimals[address(0)] = 18;
		decimals[_wrbtcTokenAddress] = 18;
		_setWrbtcToken(_wrbtcTokenAddress);
		_setProtocolTokenAddress(_protocolTokenAddress);
		_setBaseToken(_baseTokenAddress);
	}

	/**
	 * @notice Calculate the price ratio between two tokens.
	 *
	 * @dev Public wrapper for _queryRate internal function.
	 *
	 * @param sourceToken The address of the source tokens.
	 * @param destToken The address of the destiny tokens.
	 *
	 * @return rate The price ratio source/dest.
	 * @return precision The ratio precision.
	 * */
	function queryRate(address sourceToken, address destToken) public view returns (uint256 rate, uint256 precision) {
		return _queryRate(sourceToken, destToken);
	}

	/**
	 * @notice Calculate the relative precision between two tokens.
	 *
	 * @dev Public wrapper for _getDecimalPrecision internal function.
	 *
	 * @param sourceToken The address of the source tokens.
	 * @param destToken The address of the destiny tokens.
	 *
	 * @return The precision ratio source/dest.
	 * */
	function queryPrecision(address sourceToken, address destToken) public view returns (uint256) {
		return sourceToken != destToken ? _getDecimalPrecision(sourceToken, destToken) : 10**18;
	}

	/**
	 * @notice Price conversor: Calculate the price of an amount of source
	 * tokens in destiny token units.
	 *
	 * @dev NOTE: This function returns 0 during a pause, rather than a revert.
	 * Ensure calling contracts handle correctly.
	 *
	 * @param sourceToken The address of the source tokens.
	 * @param destToken The address of the destiny tokens.
	 * @param sourceAmount The amount of the source tokens.
	 *
	 * @return destAmount The amount of destiny tokens equivalent in price
	 *   to the amount of source tokens.
	 * */
	function queryReturn(
		address sourceToken,
		address destToken,
		uint256 sourceAmount
	) public view returns (uint256 destAmount) {
		if (globalPricingPaused) {
			return 0;
		}

		(uint256 rate, uint256 precision) = _queryRate(sourceToken, destToken);

		destAmount = sourceAmount.mul(rate).div(precision);
	}

	/**
	 * @notice Calculate the swap rate between two tokens.
	 *
	 * Regarding slippage, there is a hardcoded slippage limit of 5%, enforced
	 * by this function for all borrowing, lending and margin trading
	 * originated swaps performed in the Sovryn exchange.
	 *
	 * This means all operations in the Sovryn exchange are subject to losing
	 * up to 5% from the internal swap performed.
	 *
	 * @param sourceToken The address of the source tokens.
	 * @param destToken The address of the destiny tokens.
	 * @param sourceAmount The amount of source tokens.
	 * @param destAmount The amount of destiny tokens.
	 * @param maxSlippage The maximum slippage limit.
	 *
	 * @return sourceToDestSwapRate The swap rate between tokens.
	 * */
	function checkPriceDisagreement(
		address sourceToken,
		address destToken,
		uint256 sourceAmount,
		uint256 destAmount,
		uint256 maxSlippage
	) public view returns (uint256 sourceToDestSwapRate) {
		require(!globalPricingPaused, "pricing is paused");
		(uint256 rate, uint256 precision) = _queryRate(sourceToken, destToken);

		sourceToDestSwapRate = destAmount.mul(precision).div(sourceAmount);

		if (rate > sourceToDestSwapRate) {
			uint256 spreadValue = rate - sourceToDestSwapRate;
			spreadValue = spreadValue.mul(10**20).div(sourceToDestSwapRate);
			require(spreadValue <= maxSlippage, "price disagreement");
		}
	}

	/**
	 * @notice Calculate the rBTC amount equivalent to a given token amount.
	 * Native coin on RSK is rBTC. This code comes from Ethereum applications,
	 * so Eth refers to 10**18 weis of native coin, i.e.: 1 rBTC.
	 *
	 * @param tokenAddress The address of the token to calculate price.
	 * @param amount The amount of tokens to calculate price.
	 *
	 * @return ethAmount The amount of rBTC equivalent.
	 * */
	function amountInEth(address tokenAddress, uint256 amount) public view returns (uint256 ethAmount) {
		/// Token is wrBTC, amount in rBTC is the same.
		if (tokenAddress == address(wrbtcToken)) {
			ethAmount = amount;
		} else {
			(uint256 toEthRate, uint256 toEthPrecision) = queryRate(tokenAddress, address(wrbtcToken));
			ethAmount = amount.mul(toEthRate).div(toEthPrecision);
		}
	}

	/**
	 * @notice Calculate the maximum drawdown of a loan.
	 *
	 * A drawdown is commonly defined as the decline from a high peak to a
	 * pullback low of a specific investment or equity in an account.
	 *
	 * Drawdown magnitude refers to the amount of value that a user loses
	 * during the drawdown period.
	 *
	 * @param loanToken The address of the loan token.
	 * @param collateralToken The address of the collateral token.
	 * @param loanAmount The amount of the loan.
	 * @param collateralAmount The amount of the collateral.
	 * @param margin The relation between the position size and the loan.
	 *   margin = (total position size - loan) / loan
	 *
	 * @return maxDrawdown The maximum drawdown.
	 * */
	function getMaxDrawdown(
		address loanToken,
		address collateralToken,
		uint256 loanAmount,
		uint256 collateralAmount,
		uint256 margin
	) public view returns (uint256 maxDrawdown) {
		uint256 loanToCollateralAmount;
		if (collateralToken == loanToken) {
			loanToCollateralAmount = loanAmount;
		} else {
			(uint256 rate, uint256 precision) = queryRate(loanToken, collateralToken);
			loanToCollateralAmount = loanAmount.mul(rate).div(precision);
		}

		uint256 combined = loanToCollateralAmount.add(loanToCollateralAmount.mul(margin).div(10**20));

		maxDrawdown = collateralAmount > combined ? collateralAmount - combined : 0;
	}

	/**
	 * @notice Calculate the margin and the collateral on rBTC.
	 *
	 * @param loanToken The address of the loan token.
	 * @param collateralToken The address of the collateral token.
	 * @param loanAmount The amount of the loan.
	 * @param collateralAmount The amount of the collateral.
	 *
	 * @return currentMargin The margin of the loan.
	 * @return collateralInEthAmount The amount of collateral on rBTC.
	 * */
	function getCurrentMarginAndCollateralSize(
		address loanToken,
		address collateralToken,
		uint256 loanAmount,
		uint256 collateralAmount
	) public view returns (uint256 currentMargin, uint256 collateralInEthAmount) {
		(currentMargin, ) = getCurrentMargin(loanToken, collateralToken, loanAmount, collateralAmount);

		collateralInEthAmount = amountInEth(collateralToken, collateralAmount);
	}

	/**
	 * @notice Calculate the margin of a loan.
	 *
	 * @dev current margin = (total position size - loan) / loan
	 * The collateral amount passed as parameter equals the total position size.
	 *
	 * @param loanToken The address of the loan token.
	 * @param collateralToken The address of the collateral token.
	 * @param loanAmount The amount of the loan.
	 * @param collateralAmount The amount of the collateral.
	 *
	 * @return currentMargin The margin of the loan.
	 * @return collateralToLoanRate The price ratio between collateral and
	 *   loan tokens.
	 * */
	function getCurrentMargin(
		address loanToken,
		address collateralToken,
		uint256 loanAmount,
		uint256 collateralAmount
	) public view returns (uint256 currentMargin, uint256 collateralToLoanRate) {
		uint256 collateralToLoanAmount;
		if (collateralToken == loanToken) {
			collateralToLoanAmount = collateralAmount;
			collateralToLoanRate = 10**18;
		} else {
			uint256 collateralToLoanPrecision;
			(collateralToLoanRate, collateralToLoanPrecision) = queryRate(collateralToken, loanToken);

			collateralToLoanRate = collateralToLoanRate.mul(10**18).div(collateralToLoanPrecision);

			collateralToLoanAmount = collateralAmount.mul(collateralToLoanRate).div(10**18);
		}

		if (loanAmount != 0 && collateralToLoanAmount >= loanAmount) {
			return (collateralToLoanAmount.sub(loanAmount).mul(10**20).div(loanAmount), collateralToLoanRate);
		} else {
			return (0, collateralToLoanRate);
		}
	}

	/**
	 * @notice Get assessment about liquidating a loan.
	 *
	 * @param loanToken The address of the loan token.
	 * @param collateralToken The address of the collateral token.
	 * @param loanAmount The amount of the loan.
	 * @param collateralAmount The amount of the collateral.
	 * @param maintenanceMargin The minimum margin before liquidation.
	 *
	 * @return True/false to liquidate the loan.
	 * */
	function shouldLiquidate(
		address loanToken,
		address collateralToken,
		uint256 loanAmount,
		uint256 collateralAmount,
		uint256 maintenanceMargin
	) public view returns (bool) {
		(uint256 currentMargin, ) = getCurrentMargin(loanToken, collateralToken, loanAmount, collateralAmount);

		return currentMargin <= maintenanceMargin;
	}

	/*
	 * Owner functions
	 */

	/**
	 * @notice Set new value for protocolTokenEthPrice
	 *
	 * @param newPrice The new value for protocolTokenEthPrice
	 * */
	function setProtocolTokenEthPrice(uint256 newPrice) external onlyOwner {
		require(newPrice != 0, "invalid price");
		protocolTokenEthPrice = newPrice;
	}

	/**
	 * @notice Populate pricesFeeds mapping w/ values from feeds[]
	 *
	 * @param tokens The array of tokens to loop and get addresses.
	 * @param feeds The array of contract instances for every token.
	 * */
	function setPriceFeed(address[] calldata tokens, IPriceFeedsExt[] calldata feeds) external onlyOwner {
		require(tokens.length == feeds.length, "count mismatch");

		for (uint256 i = 0; i < tokens.length; i++) {
			pricesFeeds[tokens[i]] = feeds[i];
		}
	}

	/**
	 * @notice Populate decimals mapping w/ values from tokens[].decimals
	 *
	 * @param tokens The array of tokens to loop and get values from.
	 * */
	function setDecimals(IERC20[] calldata tokens) external onlyOwner {
		for (uint256 i = 0; i < tokens.length; i++) {
			decimals[address(tokens[i])] = tokens[i].decimals();
		}
	}

	/**
	 * @notice Set flag globalPricingPaused
	 *
	 * @param isPaused The new status of pause (true/false).
	 * */
	function setGlobalPricingPaused(bool isPaused) external onlyOwner {
		if (globalPricingPaused != isPaused) {
			globalPricingPaused = isPaused;

			emit GlobalPricingPaused(msg.sender, isPaused);
		}
	}

	/*
	 * Internal functions
	 */

	/**
	 * @notice Calculate the price ratio between two tokens.
	 *
	 * @param sourceToken The address of the source tokens.
	 * @param destToken The address of the destiny tokens.
	 *
	 * @return rate The price ratio source/dest.
	 * @return precision The ratio precision.
	 * */
	function _queryRate(address sourceToken, address destToken) internal view returns (uint256 rate, uint256 precision) {
		require(!globalPricingPaused, "pricing is paused");

		/// Different tokens, query prices and perform division.
		if (sourceToken != destToken) {
			uint256 sourceRate;
			if (sourceToken != address(baseToken) && sourceToken != protocolTokenAddress) {
				IPriceFeedsExt _sourceFeed = pricesFeeds[sourceToken];
				require(address(_sourceFeed) != address(0), "unsupported src feed");

				/// Query token price on priceFeedsExt instance.
				sourceRate = _sourceFeed.latestAnswer();
				require(sourceRate != 0 && (sourceRate >> 128) == 0, "price error");
			} else {
				sourceRate = sourceToken == protocolTokenAddress ? protocolTokenEthPrice : 10**18;
			}

			uint256 destRate;
			if (destToken != address(baseToken) && destToken != protocolTokenAddress) {
				IPriceFeedsExt _destFeed = pricesFeeds[destToken];
				require(address(_destFeed) != address(0), "unsupported dst feed");

				/// Query token price on priceFeedsExt instance.
				destRate = _destFeed.latestAnswer();
				require(destRate != 0 && (destRate >> 128) == 0, "price error");
			} else {
				destRate = destToken == protocolTokenAddress ? protocolTokenEthPrice : 10**18;
			}

			rate = sourceRate.mul(10**18).div(destRate);

			precision = _getDecimalPrecision(sourceToken, destToken);

			/// Same tokens, return 1 with decimals.
		} else {
			rate = 10**18;
			precision = 10**18;
		}
	}

	/**
	 * @notice Calculate the relative precision between two tokens.
	 *
	 * @param sourceToken The address of the source tokens.
	 * @param destToken The address of the destiny tokens.
	 *
	 * @return The precision ratio source/dest.
	 * */
	function _getDecimalPrecision(address sourceToken, address destToken) internal view returns (uint256) {
		/// Same tokens, return 1 with decimals.
		if (sourceToken == destToken) {
			return 10**18;

			/// Different tokens, query ERC20 precisions and return 18 +- diff.
		} else {
			uint256 sourceTokenDecimals = decimals[sourceToken];
			if (sourceTokenDecimals == 0) sourceTokenDecimals = IERC20(sourceToken).decimals();

			uint256 destTokenDecimals = decimals[destToken];
			if (destTokenDecimals == 0) destTokenDecimals = IERC20(destToken).decimals();

			if (destTokenDecimals >= sourceTokenDecimals) return 10**(SafeMath.sub(18, destTokenDecimals - sourceTokenDecimals));
			else return 10**(SafeMath.add(18, sourceTokenDecimals - destTokenDecimals));
		}
	}
}
