pragma solidity 0.5.17;
pragma experimental ABIEncoderV2;

import "./LoanTokenLogicStandard.sol";

contract LoanTokenLogicLM is LoanTokenLogicStandard {
	/**
	 * @notice deposit into the lending pool and optionally participate at the Liquidity Mining Program
	 * @param receiver the receiver of the tokens
	 * @param depositAmount The amount of underlying tokens provided on the loan.
	 *						(Not the number of loan tokens to mint).
	 * @param useLM if true -> deposit the pool tokens into the Liquidity Mining contract
	 */
	function mint(
		address receiver,
		uint256 depositAmount,
		bool useLM
	) external nonReentrant returns (uint256 minted) {
		if (useLM) return _mintWithLM(receiver, depositAmount);
		else return _mintToken(receiver, depositAmount);
	}

	/**
	 * @notice withdraws from the lending pool and optionally retrieves the pool tokens from the
	 *         Liquidity Mining Contract
	 * @param receiver the receiver of the underlying tokens. note: potetial LM rewards are always sent to the msg.sender
	 * @param burnAmount The amount of pool tokens to redeem.
	 * @param useLM if true -> deposit the pool tokens into the Liquidity Mining contract
	 */
	function burn(
		address receiver,
		uint256 burnAmount,
		bool useLM
	) external nonReentrant returns (uint256 redeemed) {
		if (useLM) redeemed = _burnFromLM(burnAmount);
		else redeemed = _burnToken(burnAmount);
		//this needs to be here and not in _burnTokens because of the WRBTC implementation
		if (redeemed != 0) {
			_safeTransfer(loanTokenAddress, receiver, redeemed, "asset transfer failed");
		}
	}
}
