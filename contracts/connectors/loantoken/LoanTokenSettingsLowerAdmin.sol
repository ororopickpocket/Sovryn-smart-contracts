/**
 * Copyright 2017-2020, bZeroX, LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0.
 */

pragma solidity 0.5.17;
pragma experimental ABIEncoderV2;

import "./AdvancedToken.sol";
import "./interfaces/ProtocolSettingsLike.sol";

contract LoanTokenSettingsLowerAdmin is AdvancedToken {
	using SafeMath for uint256;

	// It is important to maintain the variables order so the delegate calls can access sovrynContractAddress

	// ------------- MUST BE THE SAME AS IN LoanToken CONTRACT -------------------
	address public sovrynContractAddress;
	address public wrbtcTokenAddress;
	address internal target_;
	address public admin;
	// ------------- END MUST BE THE SAME AS IN LoanToken CONTRACT -------------------

	//Add new variables here on the bottom
	address public earlyAccessToken;
	address public pauser;
	address public arbitraryCallerAddress; //a universal delegate caller, used for flash borrowing
	mapping(address => bool) public flashLoanWhiteList; //#123 whitelist flashloans

	event SetEarlyAccessToken(address oldValue, address newValue);

	modifier hasEarlyAccessToken() {
		if (earlyAccessToken != address(0)) require(IERC20(earlyAccessToken).balanceOf(msg.sender) > 0, "No early access tokens");
		_;
	}

	//@todo check for restrictions in this contract
	modifier onlyAdmin() {
		require(isOwner() || msg.sender == admin, "unauthorized");
		_;
	}

	modifier onlyFlashLoanWhiteListed(address account) {
		require(flashLoanWhiteList[account], "account is not whitelisted for flash loans");
		_;
	}

	event SetTransactionLimits(address[] addresses, uint256[] limits);

	function setArbitraryCallerAddress(address caller) public onlyAdmin {
		arbitraryCallerAddress = caller;
	}

	function addToFlashLoanWhiteList(address addressToAdd) public onlyAdmin {
		flashLoanWhiteList[addressToAdd] = true;
	}

	function removeFromFlashLoanWhiteList(address addressToAdd) public onlyAdmin {
		delete flashLoanWhiteList[addressToAdd];
	}

	function setAdmin(address _admin) public onlyOwner {
		admin = _admin;
	}

	function setPauser(address _pauser) public onlyOwner {
		pauser = _pauser;
	}

	function() external {
		revert("LoanTokenSettingsLowerAdmin - fallback not allowed");
	}

	function setupLoanParams(LoanParamsStruct.LoanParams[] memory loanParamsList, bool areTorqueLoans) public onlyAdmin {
		bytes32[] memory loanParamsIdList;
		address _loanTokenAddress = loanTokenAddress;

		for (uint256 i = 0; i < loanParamsList.length; i++) {
			loanParamsList[i].loanToken = _loanTokenAddress;
			loanParamsList[i].maxLoanTerm = areTorqueLoans ? 0 : 28 days;
		}

		loanParamsIdList = ProtocolSettingsLike(sovrynContractAddress).setupLoanParams(loanParamsList);
		for (uint256 i = 0; i < loanParamsIdList.length; i++) {
			loanParamsIds[
				uint256(
					keccak256(
						abi.encodePacked(
							loanParamsList[i].collateralToken,
							areTorqueLoans // isTorqueLoan
						)
					)
				)
			] = loanParamsIdList[i];
		}
	}

	function disableLoanParams(address[] calldata collateralTokens, bool[] calldata isTorqueLoans) external onlyAdmin {
		require(collateralTokens.length == isTorqueLoans.length, "count mismatch");

		bytes32[] memory loanParamsIdList = new bytes32[](collateralTokens.length);
		for (uint256 i = 0; i < collateralTokens.length; i++) {
			uint256 id = uint256(keccak256(abi.encodePacked(collateralTokens[i], isTorqueLoans[i])));
			loanParamsIdList[i] = loanParamsIds[id];
			delete loanParamsIds[id];
		}

		ProtocolSettingsLike(sovrynContractAddress).disableLoanParams(loanParamsIdList);
	}

	// These params should be percentages represented like so: 5% = 5000000000000000000
	// rateMultiplier + baseRate can't exceed 100%
	function setDemandCurve(
		uint256 _baseRate,
		uint256 _rateMultiplier,
		uint256 _lowUtilBaseRate,
		uint256 _lowUtilRateMultiplier,
		uint256 _targetLevel,
		uint256 _kinkLevel,
		uint256 _maxScaleRate
	) public onlyAdmin {
		require(_rateMultiplier.add(_baseRate) <= WEI_PERCENT_PRECISION, "curve params too high");
		require(_lowUtilRateMultiplier.add(_lowUtilBaseRate) <= WEI_PERCENT_PRECISION, "curve params too high");

		require(_targetLevel <= WEI_PERCENT_PRECISION && _kinkLevel <= WEI_PERCENT_PRECISION, "levels too high");

		baseRate = _baseRate;
		rateMultiplier = _rateMultiplier;
		lowUtilBaseRate = _lowUtilBaseRate;
		lowUtilRateMultiplier = _lowUtilRateMultiplier;

		targetLevel = _targetLevel; // 80 ether
		kinkLevel = _kinkLevel; // 90 ether
		maxScaleRate = _maxScaleRate; // 100 ether
	}

	function toggleFunctionPause(
		string memory funcId, // example: "mint(uint256,uint256)"
		bool isPaused
	) public {
		require(msg.sender == pauser, "onlyPauser");
		// keccak256("iToken_FunctionPause")
		bytes32 slot =
			keccak256(
				abi.encodePacked(
					bytes4(keccak256(abi.encodePacked(funcId))),
					uint256(0xd46a704bc285dbd6ff5ad3863506260b1df02812f4f857c8cc852317a6ac64f2)
				)
			);
		assembly {
			sstore(slot, isPaused)
		}
	}

	/**
	 * sets the transaction limit per token address
	 * @param addresses the token addresses
	 * @param limits the limit denominated in the currency of the token address
	 * */
	function setTransactionLimits(address[] memory addresses, uint256[] memory limits) public onlyAdmin {
		require(addresses.length == limits.length, "mismatched array lengths");
		for (uint256 i = 0; i < addresses.length; i++) {
			transactionLimit[addresses[i]] = limits[i];
		}
		emit SetTransactionLimits(addresses, limits);
	}

	function changeLoanTokenNameAndSymbol(string memory _name, string memory _symbol) public onlyAdmin {
		name = _name;
		symbol = _symbol;
	}

	/**
	 *	@notice set early access token
	 *	@param _earlyAccessTokenAddress the early access token
	 */
	function setEarlyAccessToken(address _earlyAccessTokenAddress) public onlyAdmin {
		address oldEarlyAccessToken = earlyAccessToken;
		earlyAccessToken = _earlyAccessTokenAddress;
		emit SetEarlyAccessToken(oldEarlyAccessToken, earlyAccessToken);
	}
}
