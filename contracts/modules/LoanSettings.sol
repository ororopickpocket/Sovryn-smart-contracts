/**
 * Copyright 2017-2020, bZeroX, LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0.
 */

pragma solidity 0.5.17;
pragma experimental ABIEncoderV2;

import "../core/State.sol";
import "../events/LoanSettingsEvents.sol";

/**
 * @title Loan Settings contract.
 *
 * @notice This contract code comes from bZx. bZx is a protocol for tokenized
 * margin trading and lending https://bzx.network similar to the dYdX protocol.
 *
 * This contract contains functions to get and set loan parameters.
 * */
contract LoanSettings is State, LoanSettingsEvents {
	/**
	 * @notice Empty public constructor.
	 * */
	constructor() public {}

	/**
	 * @notice Fallback function is to react to receiving value (rBTC).
	 * */
	function() external {
		revert("LoanSettings - fallback not allowed");
	}

	/**
	 * @notice Set function selectors on target contract.
	 *
	 * @param target The address of the target contract.
	 * */
	function initialize(address target) external onlyOwner {
		address prevModuleContractAddress = logicTargets[this.setupLoanParams.selector];
		_setTarget(this.setupLoanParams.selector, target);
		_setTarget(this.disableLoanParams.selector, target);
		_setTarget(this.getLoanParams.selector, target);
		_setTarget(this.getLoanParamsList.selector, target);
		_setTarget(this.getTotalPrincipal.selector, target);
		emit ProtocolModuleContractReplaced(prevModuleContractAddress, target, "LoanSettings");
	}

	/**
	 * @notice Setup loan parameters, by looping every loan
	 * and populating its parameters.
	 *
	 * @dev For each loan calls _setupLoanParams internal function.
	 *
	 * @param loanParamsList The array of loan parameters.
	 *
	 * @return loanParamsIdList The array of loan parameters IDs.
	 * */
	function setupLoanParams(LoanParams[] calldata loanParamsList) external returns (bytes32[] memory loanParamsIdList) {
		loanParamsIdList = new bytes32[](loanParamsList.length);
		for (uint256 i = 0; i < loanParamsList.length; i++) {
			loanParamsIdList[i] = _setupLoanParams(loanParamsList[i]);
		}
	}

	/**
	 * @notice Deactivate LoanParams for future loans. Active loans
	 * using it are unaffected.
	 *
	 * @param loanParamsIdList The array of loan parameters IDs to deactivate.
	 * */
	function disableLoanParams(bytes32[] calldata loanParamsIdList) external {
		for (uint256 i = 0; i < loanParamsIdList.length; i++) {
			require(msg.sender == loanParams[loanParamsIdList[i]].owner, "unauthorized owner");
			loanParams[loanParamsIdList[i]].active = false;

			LoanParams memory loanParamsLocal = loanParams[loanParamsIdList[i]];
			emit LoanParamsDisabled(
				loanParamsLocal.id,
				loanParamsLocal.owner,
				loanParamsLocal.loanToken,
				loanParamsLocal.collateralToken,
				loanParamsLocal.minInitialMargin,
				loanParamsLocal.maintenanceMargin,
				loanParamsLocal.maxLoanTerm
			);
			emit LoanParamsIdDisabled(loanParamsLocal.id, loanParamsLocal.owner);
		}
	}

	/**
	 * @notice Get loan parameters for every matching IDs.
	 *
	 * @param loanParamsIdList The array of loan parameters IDs to match.
	 *
	 * @return loanParamsList The result array of loan parameters.
	 * */
	function getLoanParams(bytes32[] memory loanParamsIdList) public view returns (LoanParams[] memory loanParamsList) {
		loanParamsList = new LoanParams[](loanParamsIdList.length);
		uint256 itemCount;

		for (uint256 i = 0; i < loanParamsIdList.length; i++) {
			LoanParams memory loanParamsLocal = loanParams[loanParamsIdList[i]];
			if (loanParamsLocal.id == 0) {
				continue;
			}
			loanParamsList[itemCount] = loanParamsLocal;
			itemCount++;
		}

		if (itemCount < loanParamsList.length) {
			assembly {
				mstore(loanParamsList, itemCount)
			}
		}
	}

	/**
	 * @notice Get loan parameters for an owner and a given page
	 * defined by an offset and a limit.
	 *
	 * @param owner The address of the loan owner.
	 * @param start The page offset.
	 * @param count The page limit.
	 *
	 * @return loanParamsList The result array of loan parameters.
	 * */
	function getLoanParamsList(
		address owner,
		uint256 start,
		uint256 count
	) external view returns (bytes32[] memory loanParamsList) {
		EnumerableBytes32Set.Bytes32Set storage set = userLoanParamSets[owner];
		uint256 end = start.add(count).min256(set.length());
		if (start >= end) {
			return loanParamsList;
		}

		loanParamsList = new bytes32[](count);
		uint256 itemCount;
		for (uint256 i = end - start; i > 0; i--) {
			if (itemCount == count) {
				break;
			}
			loanParamsList[itemCount] = set.get(i + start - 1);
			itemCount++;
		}

		if (itemCount < count) {
			assembly {
				mstore(loanParamsList, itemCount)
			}
		}
	}

	/**
	 * @notice Get the total principal of the loans by a lender.
	 *
	 * @param lender The address of the lender.
	 * @param loanToken The address of the token instance.
	 *
	 * @return The total principal of the loans.
	 * */
	function getTotalPrincipal(address lender, address loanToken) external view returns (uint256) {
		return lenderInterest[lender][loanToken].principalTotal;
	}

	/**
	 * @notice Setup a loan parameters.
	 *
	 * @param loanParamsLocal The loan parameters.
	 *
	 * @return loanParamsId The loan parameters ID.
	 * */
	function _setupLoanParams(LoanParams memory loanParamsLocal) internal returns (bytes32) {
		bytes32 loanParamsId =
			keccak256(
				abi.encodePacked(
					loanParamsLocal.loanToken,
					loanParamsLocal.collateralToken,
					loanParamsLocal.minInitialMargin,
					loanParamsLocal.maintenanceMargin,
					loanParamsLocal.maxLoanTerm,
					block.timestamp
				)
			);
		require(loanParams[loanParamsId].id == 0, "loanParams exists");

		require(
			loanParamsLocal.loanToken != address(0) &&
				loanParamsLocal.collateralToken != address(0) &&
				loanParamsLocal.minInitialMargin > loanParamsLocal.maintenanceMargin &&
				(loanParamsLocal.maxLoanTerm == 0 || loanParamsLocal.maxLoanTerm > 3600), /// A defined maxLoanTerm has to be greater than one hour.
			"invalid params"
		);

		loanParamsLocal.id = loanParamsId;
		loanParamsLocal.active = true;
		loanParamsLocal.owner = msg.sender;

		loanParams[loanParamsId] = loanParamsLocal;
		userLoanParamSets[msg.sender].addBytes32(loanParamsId);

		emit LoanParamsSetup(
			loanParamsId,
			loanParamsLocal.owner,
			loanParamsLocal.loanToken,
			loanParamsLocal.collateralToken,
			loanParamsLocal.minInitialMargin,
			loanParamsLocal.maintenanceMargin,
			loanParamsLocal.maxLoanTerm
		);
		emit LoanParamsIdSetup(loanParamsId, loanParamsLocal.owner);

		return loanParamsId;
	}
}
