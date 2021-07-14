pragma solidity 0.5.17;

import "../modules/ProtocolSettings.sol";
import "../modules/SwapsExternal.sol";

contract ProtocolSettingsMockup is ProtocolSettings, SwapsExternal {
	function setLendingFeeTokensHeld(address token, uint256 amout) public {
		lendingFeeTokensHeld[token] = amout;
	}

	function setTradingFeeTokensHeld(address token, uint256 amout) public {
		tradingFeeTokensHeld[token] = amout;
	}

	function setBorrowingFeeTokensHeld(address token, uint256 amout) public {
		borrowingFeeTokensHeld[token] = amout;
	}

	function initialize(address target) external onlyOwner {
		_setTarget(this.setPriceFeedContract.selector, target);
		_setTarget(this.setSwapsImplContract.selector, target);
		_setTarget(this.setLoanPool.selector, target);
		_setTarget(this.setSupportedTokens.selector, target);
		_setTarget(this.setLendingFeePercent.selector, target);
		_setTarget(this.setTradingFeePercent.selector, target);
		_setTarget(this.setBorrowingFeePercent.selector, target);
		_setTarget(this.setAffiliateFeePercent.selector, target);
		_setTarget(this.setAffiliateTradingTokenFeePercent.selector, target);
		_setTarget(this.setLiquidationIncentivePercent.selector, target);
		_setTarget(this.setMaxDisagreement.selector, target);
		_setTarget(this.setSourceBuffer.selector, target);
		_setTarget(this.setMaxSwapSize.selector, target);
		_setTarget(this.setFeesController.selector, target);
		_setTarget(this.withdrawFees.selector, target);
		_setTarget(this.withdrawLendingFees.selector, target);
		_setTarget(this.withdrawTradingFees.selector, target);
		_setTarget(this.withdrawBorrowingFees.selector, target);
		_setTarget(this.withdrawProtocolToken.selector, target);
		_setTarget(this.depositProtocolToken.selector, target);
		_setTarget(this.getLoanPoolsList.selector, target);
		_setTarget(this.isLoanPool.selector, target);
		_setTarget(this.setSovrynSwapContractRegistryAddress.selector, target);
		_setTarget(this.setWrbtcToken.selector, target);
		_setTarget(this.setSovrynProtocolAddress.selector, target);
		_setTarget(this.setProtocolTokenAddress.selector, target);
		_setTarget(this.setSOVTokenAddress.selector, target);
		_setTarget(this.setLockedSOVAddress.selector, target);
		_setTarget(this.setMinReferralsToPayoutAffiliates.selector, target);
		_setTarget(this.setRolloverBaseReward.selector, target);

		_setTarget(this.setLendingFeeTokensHeld.selector, target);
		_setTarget(this.setTradingFeeTokensHeld.selector, target);
		_setTarget(this.setBorrowingFeeTokensHeld.selector, target);

		_setTarget(this.getProtocolAddress.selector, target);
		_setTarget(this.getSovTokenAddress.selector, target);
		_setTarget(this.getLockedSOVAddress.selector, target);

		_setTarget(this.swapExternal.selector, target);
	}
}
