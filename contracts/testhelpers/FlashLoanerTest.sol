pragma solidity ^0.5.17;
pragma experimental ABIEncoderV2;
// "SPDX-License-Identifier: Apache-2.0"

import "../interfaces/IERC20.sol";
import "../openzeppelin/Ownable.sol";
import "./ITokenFlashLoanTest.sol";

contract FlashLoanerTest is Ownable {
	function initiateFlashLoanTest(
		address loanToken,
		address iToken,
		uint256 flashLoanAmount
	) internal returns (bytes memory success) {
		ITokenFlashLoanTest iTokenContract = ITokenFlashLoanTest(iToken);
		return
			iTokenContract.flashBorrow(
				flashLoanAmount,
				address(this),
				address(this),
				"",
				abi.encodeWithSignature("executeOperation(address,address,uint256)", loanToken, iToken, flashLoanAmount)
			);
	}

	function repayFlashLoan(
		address loanToken,
		address iToken,
		uint256 loanAmount
	) internal {
		IERC20(loanToken).transfer(iToken, loanAmount);
		emit BalanceOfAfterRepaid(IERC20(loanToken).balanceOf(address(this)));
	}

	function executeOperation(
		address loanToken,
		address iToken,
		uint256 loanAmount
	) external returns (bytes memory success) {
		emit BalanceOf(IERC20(loanToken).balanceOf(address(this)));
		emit ExecuteOperation(loanToken, iToken, loanAmount);
		repayFlashLoan(loanToken, iToken, loanAmount);
		return bytes("1");
	}

	function doStuffWithFlashLoan(
		address token,
		address iToken,
		uint256 amount
	) external onlyOwner {
		bytes memory result;
		emit BalanceOf(IERC20(token).balanceOf(address(this)));

		result = initiateFlashLoanTest(token, iToken, amount);

		emit BalanceOf(IERC20(token).balanceOf(address(this)));
		// after loan checks and what not.
		if (hashCompareWithLengthCheck(bytes("1"), result)) {
			revert("failed executeOperation");
		}
	}

	function hashCompareWithLengthCheck(bytes memory a, bytes memory b) internal pure returns (bool) {
		if (a.length != b.length) {
			return false;
		} else {
			return keccak256(a) == keccak256(b);
		}
	}

	event ExecuteOperation(address loanToken, address iToken, uint256 loanAmount);

	event BalanceOf(uint256 balance);

	event BalanceOfAfterRepaid(uint256 balance);
}
