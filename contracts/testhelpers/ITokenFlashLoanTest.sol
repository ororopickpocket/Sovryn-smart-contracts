pragma solidity ^0.5.17;
pragma experimental ABIEncoderV2;

// "SPDX-License-Identifier: Apache-2.0"

interface ITokenFlashLoanTest {
	function flashBorrow(
		uint256 borrowAmount,
		address borrower,
		address target,
		string calldata signature,
		bytes calldata data
	) external payable returns (bytes memory);
}
