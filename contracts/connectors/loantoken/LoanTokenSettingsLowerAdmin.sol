/**
 * Copyright 2017-2021, bZeroX, LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0.
 */

pragma solidity 0.5.17;
pragma experimental ABIEncoderV2;

import "./AdvancedToken.sol";
import "./interfaces/ProtocolSettingsLike.sol";

contract LoanTokenSettingsLowerAdmin is AdvancedToken {
	using SafeMath for uint256;

	/* Storage */

	/// @dev It is important to maintain the variables order so the delegate
	/// calls can access sovrynContractAddress

	/// ------------- MUST BE THE SAME AS IN LoanToken CONTRACT -------------------
	address public sovrynContractAddress;
	address public wrbtcTokenAddress;
	address public target_;
	address public admin;
	/// ------------- END MUST BE THE SAME AS IN LoanToken CONTRACT -------------------

	/// @dev Add new variables here on the bottom.
	address public earlyAccessToken; //not used anymore, but staying for upgradability
	address public pauser;
	/** The address of the liquidity mining contract */
	address public liquidityMiningAddress;

	/// @dev TODO: Check for restrictions in this contract.
	modifier onlyAdmin() {
		require(isOwner() || msg.sender == admin, "unauthorized");
		_;
	}

	/* Events */

	event SetTransactionLimits(address[] addresses, uint256[] limits);
	event ToggleFunctionPaused(string functionId, bool prevFlag, bool newFlag);

	/* Functions */

	/**
	 * @notice Set admin account.
	 * @param _admin The address of the account to grant admin permissions.
	 * */
	function setAdmin(address _admin) public onlyOwner {
		admin = _admin;
	}

	/**
	 * @notice Set pauser account.
	 * @param _pauser The address of the account to grant pause permissions.
	 * */
	function setPauser(address _pauser) public onlyOwner {
		pauser = _pauser;
	}

	/**
	 * @notice Fallback function not allowed
	 * */
	function() external {
		revert("LoanTokenSettingsLowerAdmin - fallback not allowed");
	}

	/**
	 * @notice Set loan token parameters.
	 *
	 * @param loanParamsList The array of loan parameters.
	 * @param areTorqueLoans Whether the loan is a torque loan.
	 * */
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
							areTorqueLoans /// isTorqueLoan
						)
					)
				)
			] = loanParamsIdList[i];
		}
	}

	/**
	 * @notice Disable loan token parameters.
	 *
	 * @param collateralTokens The array of collateral tokens.
	 * @param isTorqueLoans Whether the loan is a torque loan.
	 * */
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

	/**
	 * @notice Set loan token parameters about the demand curve.
	 *
	 * @dev These params should be percentages represented
	 *   like so: 5% = 5000000000000000000 /// 18 digits precision.
	 * rateMultiplier + baseRate can't exceed 100%
	 *
	 * To maintain a healthy credit score, it's important to keep your
	 * credit utilization rate (CUR) low (_lowUtilBaseRate). In general
	 * you don't want your CUR to exceed 30%, but increasingly financial
	 * experts are recommending that you don't want to go above 10% if you
	 * really want an excellent credit score.
	 *
	 * Interest rates tend to cluster around the kink level of a kinked
	 * interest rate model. More info at https://arxiv.org/pdf/2006.13922.pdf
	 * and https://compound.finance/governance/proposals/12
	 *
	 * @param _baseRate The interest rate.
	 * @param _rateMultiplier The precision multiplier for base rate.
	 * @param _lowUtilBaseRate The credit utilization rate (CUR) low value.
	 * @param _lowUtilRateMultiplier The precision multiplier for low util base rate.
	 * @param _targetLevel The target level.
	 * @param _kinkLevel The level that interest rates cluster on kinked model.
	 * @param _maxScaleRate The maximum rate of the scale.
	 * */
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

		targetLevel = _targetLevel; /// 80 ether
		kinkLevel = _kinkLevel; /// 90 ether
		maxScaleRate = _maxScaleRate; /// 100 ether
	}

	/**
	 * @notice Set the pause flag for a function to true or false.
	 *
	 * @dev Combining the hash of "iToken_FunctionPause" string and a function
	 *   selector gets a slot to write a flag for pause state.
	 *
	 * @param funcId The ID of a function, the selector.
	 * @param isPaused true/false value of the flag.
	 * */
	function toggleFunctionPause(
		string memory funcId, /// example: "mint(uint256,uint256)"
		bool isPaused
	) public {
		require(msg.sender == pauser, "onlyPauser");
		/// keccak256("iToken_FunctionPause")
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
		emit ToggleFunctionPaused(funcId, !isPaused, isPaused);
	}

	/**
	 * Set the transaction limit per token address.
	 * @param addresses The token addresses.
	 * @param limits The limit denominated in the currency of the token address.
	 * */
	function setTransactionLimits(address[] memory addresses, uint256[] memory limits) public onlyAdmin {
		require(addresses.length == limits.length, "mismatched array lengths");
		for (uint256 i = 0; i < addresses.length; i++) {
			transactionLimit[addresses[i]] = limits[i];
		}
		emit SetTransactionLimits(addresses, limits);
	}

	/**
	 *	@notice Update the loan token parameters.
	 *	@param _name The new name of the loan token.
	 *	@param _symbol The new symbol of the loan token.
	 * */
	function changeLoanTokenNameAndSymbol(string memory _name, string memory _symbol) public onlyAdmin {
		name = _name;
		symbol = _symbol;
	}
}
