const { expect } = require("chai");
const { expectRevert, expectEvent, constants, BN, balance, time } = require("@openzeppelin/test-helpers");

const { ZERO_ADDRESS } = constants;

const { encodeParameters, etherMantissa, mineBlock, increaseTime, blockNumber } = require("./Utils/Ethereum");

const TestToken = artifacts.require("TestToken");
const TestWrbtc = artifacts.require("TestWrbtc");

const StakingLogic = artifacts.require("StakingMockup");
const StakingProxy = artifacts.require("StakingProxy");

const Protocol = artifacts.require("sovrynProtocol");
const ProtocolSettings = artifacts.require("ProtocolSettingsMockup");
const LoanMaintenance = artifacts.require("LoanMaintenance");
const LoanSettings = artifacts.require("LoanSettings");
const LoanOpenings = artifacts.require("LoanOpenings");
const LoanClosingsBase = artifacts.require("LoanClosingsBase");
const LoanClosingsWith = artifacts.require("LoanClosingsWith");

const LoanTokenLogic = artifacts.require("LoanTokenLogicStandard");
const LoanTokenLogicWrbtc = artifacts.require("LoanTokenLogicWrbtc");
const LoanTokenSettings = artifacts.require("LoanTokenSettingsLowerAdmin");
const LoanToken = artifacts.require("LoanToken");

const FeeSharingProxy = artifacts.require("FeeSharingProxy");
const FeeSharingProxyMockup = artifacts.require("FeeSharingProxyMockup");

const PriceFeedsLocal = artifacts.require("PriceFeedsLocal");
const TestSovrynSwap = artifacts.require("TestSovrynSwap");
const SwapsImplSovrynSwap = artifacts.require("SwapsImplSovrynSwap");


const TOTAL_SUPPLY = etherMantissa(1000000000);

const MAX_DURATION = new BN(24 * 60 * 60).mul(new BN(1092));
const TWO_WEEKS = 1209600;

const MAX_VOTING_WEIGHT = 10;

const FEE_WITHDRAWAL_INTERVAL = 86400;

const MOCK_PRIOR_WEIGHTED_STAKE = false;

const wei = web3.utils.toWei;

const { lend_btc_before_cashout } = require("./loan-token/helpers");

contract("FeeSharingProxy:", (accounts) => {
	const name = "Test SOVToken";
	const symbol = "TST";

	let root, account1, account2, account3, account4;
	let SOVToken, susd, wrbtc, staking;
	let protocol;
	let loanTokenSettings, loanTokenLogic, loanToken;
	let feeSharingProxy;
	let loanTokenWrbtc;
	let tradingFeePercent;
	let mockPrice;

	before(async () => {
		[root, account1, account2, account3, account4, ...accounts] = accounts;
	});

	beforeEach(async () => {
		//Token
		SOVToken = await TestToken.new(name, symbol, 18, TOTAL_SUPPLY);
		susd = await TestToken.new("SUSD", "SUSD", 18, TOTAL_SUPPLY);
		wrbtc = await TestWrbtc.new();

		//Staking
		let stakingLogic = await StakingLogic.new(SOVToken.address);
		staking = await StakingProxy.new(SOVToken.address);
		await staking.setImplementation(stakingLogic.address);
		staking = await StakingLogic.at(staking.address);

		//Protocol
		protocol = await Protocol.new();
		let protocolSettings = await ProtocolSettings.new();
		await protocol.replaceContract(protocolSettings.address);
		let loanMaintenance = await LoanMaintenance.new();
		await protocol.replaceContract(loanMaintenance.address);
		let loanSettings = await LoanSettings.new();
		await protocol.replaceContract(loanSettings.address);
		let loanOpenings = await LoanOpenings.new();
		await protocol.replaceContract(loanOpenings.address);
		let loanClosingsBase = await LoanClosingsBase.new();
		await protocol.replaceContract(loanClosingsBase.address);
		let loanClosingsWith = await LoanClosingsWith.new();
		await protocol.replaceContract(loanClosingsWith.address);

		protocol = await ProtocolSettings.at(protocol.address);
		//Loan token
		loanTokenSettings = await LoanTokenSettings.new();
		loanTokenLogic = await LoanTokenLogic.new();
		loanToken = await LoanToken.new(root, loanTokenLogic.address, protocol.address, wrbtc.address);
		await loanToken.initialize(susd.address, "iSUSD", "iSUSD");
		loanToken = await LoanTokenLogic.at(loanToken.address);
		await loanToken.setAdmin(root);
		await protocol.setLoanPool([loanToken.address], [susd.address]);
		//FeeSharingProxy
		feeSharingProxy = await FeeSharingProxy.new(protocol.address, staking.address, wrbtc.address);
		await protocol.setFeesController(feeSharingProxy.address);

		// Set loan pool for wRBTC -- because our fee sharing proxy required the loanPool of wRBTC
		loanTokenLogicWrbtc = await LoanTokenLogicWrbtc.new();
		loanTokenWrbtc = await LoanToken.new(root, loanTokenLogicWrbtc.address, protocol.address, wrbtc.address);
		await loanTokenWrbtc.initialize(wrbtc.address, "iWRBTC", "iWRBTC");

		loanTokenWrbtc = await LoanTokenLogicWrbtc.at(loanTokenWrbtc.address);
		const loanTokenAddressWrbtc = await loanTokenWrbtc.loanTokenAddress();
		await protocol.setLoanPool([loanTokenWrbtc.address], [loanTokenAddressWrbtc]);

		await wrbtc.mint(protocol.address, wei("500", "ether"));

		await protocol.setWrbtcToken(wrbtc.address);
		await protocol.setSovrynProtocolAddress(protocol.address);

		// // Set PriceFeeds
		feeds = await PriceFeedsLocal.new(wrbtc.address, protocol.address);
		mockPrice = "1"
		await feeds.setRates(susd.address, wrbtc.address, wei(mockPrice, "ether"));
		const swaps = await SwapsImplSovrynSwap.new();
		const sovrynSwapSimulator = await TestSovrynSwap.new(feeds.address);
		await protocol.setSovrynSwapContractRegistryAddress(sovrynSwapSimulator.address);
		await protocol.setSupportedTokens([susd.address, wrbtc.address], [true, true]);
		await protocol.setPriceFeedContract(
			feeds.address //priceFeeds
		);
		await protocol.setSwapsImplContract(
			swaps.address // swapsImpl
		);

		tradingFeePercent = await protocol.tradingFeePercent();
		await lend_btc_before_cashout(loanTokenWrbtc, new BN(wei("10", "ether")), root);
	});

	describe("setWRBTCAddress", () => {
		it("set wrbtc address should failed if not set by the owner", async () => {
			await expectRevert(feeSharingProxy.setWRBTCAddress(wrbtc.address, {from: account1}), "unauthorized");
		})

		it("set wrbtc address should failed if not set by the owner", async () => {
			const oldWrbtcAddress = await feeSharingProxy.wRBTCAddress();
			newWrbtc = await TestWrbtc.new();
			const tx = await feeSharingProxy.setWRBTCAddress(newWrbtc.address);
			const newWrbtcAddress = await feeSharingProxy.wRBTCAddress();
			expect(newWrbtcAddress).to.be.equal(newWrbtc.address);

			expectEvent(tx, "SetWrbtcToken", {
				sender: root,
				oldWRBTCAddress: oldWrbtcAddress,
				newWRBTCAddress: newWrbtc.address,
			});
		})
	})

	describe("withdrawFees", () => {
		it("Shouldn't be able to use zero token address", async () => {
			await expectRevert(feeSharingProxy.withdrawFees([ZERO_ADDRESS]), "FeeSharingProxy::withdrawFees: invalid address");
		});

		it("Shouldn't be able to withdraw if wRBTC loan pool does not exist", async () => {
			// Unset the loanPool for wRBTC
			await protocol.setLoanPool([loanTokenWrbtc.address], [ZERO_ADDRESS]);
			await expectRevert(feeSharingProxy.withdrawFees([loanTokenWrbtc.address]), "FeeSharingProxy::withdrawFees: loan wRBTC not found");
		});

		it("Shouldn't be able to withdraw zero amount", async () => {
			await expectRevert(feeSharingProxy.withdrawFees([susd.address]), "FeeSharingProxy::withdrawFees: no tokens to withdraw");
		});

		it("ProtocolSettings.withdrawFees", async () => {
			//stake - getPriorTotalVotingPower
			let totalStake = 1000;
			await stake(totalStake, root);

			//mock data
			let lendingFeeTokensHeld = new BN(wei("1", "ether"))
			let tradingFeeTokensHeld = new BN(wei("2", "ether"))
			let borrowingFeeTokensHeld = new BN(wei("3", "ether"))
			let totalFeeTokensHeld = (lendingFeeTokensHeld.add(tradingFeeTokensHeld)).add(borrowingFeeTokensHeld)

			let feeAmount = await setFeeTokensHeld(lendingFeeTokensHeld, tradingFeeTokensHeld, borrowingFeeTokensHeld);
			// let feeAmount = await setFeeTokensHeld(new BN(100), new BN(200), new BN(300));
			await protocol.setFeesController(root);
			let tx = await protocol.withdrawFees([susd.address], account1);
			let swapFee = totalFeeTokensHeld.mul(tradingFeePercent).div(new BN(wei("100", "ether"))) // 100 ether is for the percentage

			await checkWithdrawFee(swapFee);

			//check wrbtc balance (wrbt balance = (totalFeeTokensHeld * mockPrice) - swapFee)
			let userBalance = await wrbtc.balanceOf.call(account1);
			let wrbtcBalanceShouldBe = (feeAmount.mul(new BN(mockPrice) )).sub(swapFee);
			expect(userBalance.toString()).to.be.equal( wrbtcBalanceShouldBe.toString() );

			expectEvent(tx, "WithdrawFees", {
				sender: root,
				token: susd.address,
				receiver: account1,
				lendingAmount: lendingFeeTokensHeld,
				tradingAmount: tradingFeeTokensHeld,
				borrowingAmount: borrowingFeeTokensHeld,
				// amountConvertedToWRBTC
			});
		});

		it("Should be able to withdraw fees", async () => {
			//stake - getPriorTotalVotingPower
			let totalStake = 1000;
			await stake(totalStake, root);

			//mock data
			let lendingFeeTokensHeld = new BN(wei("1", "ether"))
			let tradingFeeTokensHeld = new BN(wei("2", "ether"))
			let borrowingFeeTokensHeld = new BN(wei("3", "ether"))
			let totalFeeTokensHeld = (lendingFeeTokensHeld.add(tradingFeeTokensHeld)).add(borrowingFeeTokensHeld)
			let feeAmount = await setFeeTokensHeld(lendingFeeTokensHeld, tradingFeeTokensHeld, borrowingFeeTokensHeld);

			tx = await feeSharingProxy.withdrawFees([susd.address]);
			let swapFee = totalFeeTokensHeld.mul(tradingFeePercent).div(new BN(wei("100", "ether")))

			await checkWithdrawFee(swapFee);

			//check wrbtc balance (wrbt balance = (totalFeeTokensHeld * mockPrice) - swapFee)
			let feeSharingProxyBalance = await loanTokenWrbtc.balanceOf.call(feeSharingProxy.address);
			let loanTokenWRBTCBalanceShouldBe = (feeAmount.mul(new BN(mockPrice) )).sub(swapFee);
			expect(feeSharingProxyBalance.toString()).to.be.equal(loanTokenWRBTCBalanceShouldBe.toString());

			//checkpoints
			let numTokenCheckpoints = await feeSharingProxy.numTokenCheckpoints.call(loanTokenWrbtc.address);
			expect(numTokenCheckpoints.toNumber()).to.be.equal(1);
			let checkpoint = await feeSharingProxy.tokenCheckpoints.call(loanTokenWrbtc.address, 0);
			expect(checkpoint.blockNumber.toNumber()).to.be.equal(tx.receipt.blockNumber);
			expect(checkpoint.totalWeightedStake.toNumber()).to.be.equal(totalStake * MAX_VOTING_WEIGHT);
			expect(checkpoint.numTokens.toString()).to.be.equal(loanTokenWRBTCBalanceShouldBe.toString());

			//check lastFeeWithdrawalTime
			let lastFeeWithdrawalTime = await feeSharingProxy.lastFeeWithdrawalTime.call(loanTokenWrbtc.address);
			let block = await web3.eth.getBlock(tx.receipt.blockNumber);
			expect(lastFeeWithdrawalTime.toString()).to.be.equal(block.timestamp.toString());

			expectEvent(tx, "FeeWithdrawn", {
				sender: root,
				token: loanTokenWrbtc.address,
				amount: loanTokenWRBTCBalanceShouldBe,
			});
		});

		it("Should be able to withdraw fees 3 times", async () => {
			//stake - getPriorTotalVotingPower
			let totalStake = 1000;
			await stake(1000, root);

			//[FIRST]
			//mock data
			let mockAmountLendingFeeTokensHeld = 0;
			let mockAmountTradingFeeTokensHeld = 1;
			let mockAmountBorrowingFeeTokensHeld = 2;
			let totalMockAmount1 = mockAmountLendingFeeTokensHeld + mockAmountTradingFeeTokensHeld + mockAmountBorrowingFeeTokensHeld;
			let lendingFeeTokensHeld = new BN(mockAmountLendingFeeTokensHeld)
			let tradingFeeTokensHeld = new BN(wei(mockAmountTradingFeeTokensHeld.toString(), "ether"))
			let borrowingFeeTokensHeld = new BN(wei(mockAmountBorrowingFeeTokensHeld.toString(), "ether"))
			let totalFeeTokensHeld = (lendingFeeTokensHeld.add(tradingFeeTokensHeld)).add(borrowingFeeTokensHeld)
			let feeAmount = await setFeeTokensHeld(lendingFeeTokensHeld, tradingFeeTokensHeld, borrowingFeeTokensHeld);

			let tx = await feeSharingProxy.withdrawFees([susd.address]);
			let swapFee = totalFeeTokensHeld.mul(tradingFeePercent).div(new BN(wei("100", "ether")))

			await checkWithdrawFee(swapFee);

			//check wrbtc balance (wrbt balance = (totalFeeTokensHeld * mockPrice) - swapFee)
			let feeSharingProxyBalance = await loanTokenWrbtc.balanceOf.call(feeSharingProxy.address);
			let loanTokenWRBTCBalanceShouldBe = (feeAmount.mul(new BN(mockPrice) )).sub(swapFee);
			let totalLoanTokenWRBTCBalanceShouldBe = loanTokenWRBTCBalanceShouldBe;
			expect(feeSharingProxyBalance.toString()).to.be.equal(totalLoanTokenWRBTCBalanceShouldBe.toString());

			//checkpoints
			let numTokenCheckpoints = await feeSharingProxy.numTokenCheckpoints.call(loanTokenWrbtc.address);
			expect(numTokenCheckpoints.toNumber()).to.be.equal(1);
			let checkpoint = await feeSharingProxy.tokenCheckpoints.call(loanTokenWrbtc.address, 0);
			expect(checkpoint.blockNumber.toNumber()).to.be.equal(tx.receipt.blockNumber);
			expect(checkpoint.totalWeightedStake.toNumber()).to.be.equal(totalStake * MAX_VOTING_WEIGHT);
			expect(checkpoint.numTokens.toString()).to.be.equal(loanTokenWRBTCBalanceShouldBe.toString());

			//check lastFeeWithdrawalTime
			let lastFeeWithdrawalTime = await feeSharingProxy.lastFeeWithdrawalTime.call(loanTokenWrbtc.address);
			let block = await web3.eth.getBlock(tx.receipt.blockNumber);
			expect(lastFeeWithdrawalTime.toString()).to.be.equal(block.timestamp.toString());

			//[SECOND]
			//mock data
			let mockAmountLendingFeeTokensHeld2 = 1;
			let mockAmountTradingFeeTokensHeld2 = 0;
			let mockAmountBorrowingFeeTokensHeld2 = 0;
			let totalMockAmount2 = mockAmountTradingFeeTokensHeld2+mockAmountBorrowingFeeTokensHeld2+mockAmountLendingFeeTokensHeld2;
			lendingFeeTokensHeld = new BN(wei(mockAmountLendingFeeTokensHeld2.toString(), "ether"));
			tradingFeeTokensHeld = new BN(mockAmountTradingFeeTokensHeld2);
			borrowingFeeTokensHeld = new BN(mockAmountBorrowingFeeTokensHeld2);
			totalFeeTokensHeld = (lendingFeeTokensHeld.add(tradingFeeTokensHeld)).add(borrowingFeeTokensHeld)
			feeAmount = await setFeeTokensHeld(lendingFeeTokensHeld, tradingFeeTokensHeld, borrowingFeeTokensHeld);

			tx = await feeSharingProxy.withdrawFees([susd.address]);
			// In this state the price of susd/wrbtc already adjusted because of previous swap, so we need to consider this in the next swapFee calculation
			swapFee = totalFeeTokensHeld.mul(tradingFeePercent).div(new BN(wei("100", "ether")))

			// Need to checkwithdrawfee manually
			checkWithdrawFeeAfterPriceChanged(swapFee, new BN(totalMockAmount1 + totalMockAmount2))

			//check wrbtc balance (wrbt balance = (totalFeeTokensHeld * mockPrice) - swapFee)
			feeSharingProxyBalance = await loanTokenWrbtc.balanceOf.call(feeSharingProxy.address);
			loanTokenWRBTCBalanceShouldBe = (feeAmount.mul(new BN(mockPrice) )).sub(swapFee);
			totalLoanTokenWRBTCBalanceShouldBe = totalLoanTokenWRBTCBalanceShouldBe.add(loanTokenWRBTCBalanceShouldBe);
			let unprocessedAmount = loanTokenWRBTCBalanceShouldBe;
			expect(feeSharingProxyBalance.toString()).to.be.equal(totalLoanTokenWRBTCBalanceShouldBe.toString());

			//[THIRD]
			//mock data
			let mockAmountLendingFeeTokensHeld3 = 0;
			let mockAmountTradingFeeTokensHeld3 = 0.5;
			let mockAmountBorrowingFeeTokensHeld3 = 0.5;
			let totalMockAmount3 = mockAmountTradingFeeTokensHeld3 + mockAmountBorrowingFeeTokensHeld3 + mockAmountLendingFeeTokensHeld3;
			lendingFeeTokensHeld = new BN(mockAmountLendingFeeTokensHeld3);
			tradingFeeTokensHeld = new BN(wei(mockAmountTradingFeeTokensHeld3.toString(), "ether"));
			borrowingFeeTokensHeld = new BN(wei(mockAmountBorrowingFeeTokensHeld3.toString(), "ether"));
			totalFeeTokensHeld = (lendingFeeTokensHeld.add(tradingFeeTokensHeld)).add(borrowingFeeTokensHeld)
			feeAmount = await setFeeTokensHeld(lendingFeeTokensHeld, tradingFeeTokensHeld, borrowingFeeTokensHeld);

			await increaseTime(FEE_WITHDRAWAL_INTERVAL);
			tx = await feeSharingProxy.withdrawFees([susd.address]);
			// In this state the price of susd/wrbtc already adjusted because of previous swap, so we need to consider this in the next swapFee calculation
			swapFee = totalFeeTokensHeld.mul(tradingFeePercent).div(new BN(wei("100", "ether")))
			await checkWithdrawFeeAfterPriceChanged(swapFee, new BN(totalMockAmount1 + totalMockAmount2 + totalMockAmount3));

			//check wrbtc balance (wrbt balance = (totalFeeTokensHeld * mockPrice) - swapFee)
			feeSharingProxyBalance = await loanTokenWrbtc.balanceOf.call(feeSharingProxy.address);
			loanTokenWRBTCBalanceShouldBe = (feeAmount.mul(new BN(mockPrice) )).sub(swapFee);
			totalLoanTokenWRBTCBalanceShouldBe = totalLoanTokenWRBTCBalanceShouldBe.add(loanTokenWRBTCBalanceShouldBe);
			expect(feeSharingProxyBalance.toString()).to.be.equal(totalLoanTokenWRBTCBalanceShouldBe.toString());

			//checkpoints
			numTokenCheckpoints = await feeSharingProxy.numTokenCheckpoints.call(loanTokenWrbtc.address);
			expect(numTokenCheckpoints.toNumber()).to.be.equal(2);
			checkpoint = await feeSharingProxy.tokenCheckpoints.call(loanTokenWrbtc.address, 1);
			expect(checkpoint.blockNumber.toNumber()).to.be.equal(tx.receipt.blockNumber);
			expect(checkpoint.totalWeightedStake.toNumber()).to.be.equal(totalStake * MAX_VOTING_WEIGHT);
			expect(checkpoint.numTokens.toString()).to.be.equal(loanTokenWRBTCBalanceShouldBe.add(unprocessedAmount).toString());

			// //check lastFeeWithdrawalTime
			lastFeeWithdrawalTime = await feeSharingProxy.lastFeeWithdrawalTime.call(loanTokenWrbtc.address);
			block = await web3.eth.getBlock(tx.receipt.blockNumber);
			expect(lastFeeWithdrawalTime.toString()).to.be.equal(block.timestamp.toString());
		});
	});

	describe("transferTokens", () => {
		it("Shouldn't be able to use zero token address", async () => {
			await expectRevert(feeSharingProxy.transferTokens(ZERO_ADDRESS, 1000), "FeeSharingProxy::transferTokens: invalid address");
		});

		it("Shouldn't be able to transfer zero amount", async () => {
			await expectRevert(feeSharingProxy.transferTokens(SOVToken.address, 0), "FeeSharingProxy::transferTokens: invalid amount");
		});

		it("Shouldn't be able to withdraw zero amount", async () => {
			await expectRevert(feeSharingProxy.transferTokens(SOVToken.address, 1000), "invalid transfer");
		});

		it("Should be able to transfer tokens", async () => {
			// stake - getPriorTotalVotingPower
			let totalStake = 1000;
			await stake(totalStake, root);

			let amount = 1000;
			await SOVToken.approve(feeSharingProxy.address, amount * 7);

			let tx = await feeSharingProxy.transferTokens(SOVToken.address, amount);

			expect(await feeSharingProxy.unprocessedAmount.call(SOVToken.address)).to.be.bignumber.equal(new BN(0));

			expectEvent(tx, "TokensTransferred", {
				sender: root,
				token: SOVToken.address,
				amount: new BN(amount),
			});

			//checkpoints
			let numTokenCheckpoints = await feeSharingProxy.numTokenCheckpoints.call(SOVToken.address);
			expect(numTokenCheckpoints.toNumber()).to.be.equal(1);
			let checkpoint = await feeSharingProxy.tokenCheckpoints.call(SOVToken.address, 0);
			expect(checkpoint.blockNumber.toNumber()).to.be.equal(tx.receipt.blockNumber);
			expect(checkpoint.totalWeightedStake.toNumber()).to.be.equal(totalStake * MAX_VOTING_WEIGHT);
			expect(checkpoint.numTokens.toString()).to.be.equal(amount.toString());

			//check lastFeeWithdrawalTime
			let lastFeeWithdrawalTime = await feeSharingProxy.lastFeeWithdrawalTime.call(SOVToken.address);
			let block = await web3.eth.getBlock(tx.receipt.blockNumber);
			expect(lastFeeWithdrawalTime.toString()).to.be.equal(block.timestamp.toString());

			expectEvent(tx, "CheckpointAdded", {
				sender: root,
				token: SOVToken.address,
				amount: new BN(amount),
			});

			//second time
			tx = await feeSharingProxy.transferTokens(SOVToken.address, amount * 2);

			expect(await feeSharingProxy.unprocessedAmount.call(SOVToken.address)).to.be.bignumber.equal(new BN(amount * 2));

			expectEvent(tx, "TokensTransferred", {
				sender: root,
				token: SOVToken.address,
				amount: new BN(amount * 2),
			});

			await increaseTime(FEE_WITHDRAWAL_INTERVAL);
			//third time
			tx = await feeSharingProxy.transferTokens(SOVToken.address, amount * 4);

			expect(await feeSharingProxy.unprocessedAmount.call(SOVToken.address)).to.be.bignumber.equal(new BN(0));

			//checkpoints
			numTokenCheckpoints = await feeSharingProxy.numTokenCheckpoints.call(SOVToken.address);
			expect(numTokenCheckpoints.toNumber()).to.be.equal(2);
			checkpoint = await feeSharingProxy.tokenCheckpoints.call(SOVToken.address, 1);
			expect(checkpoint.blockNumber.toNumber()).to.be.equal(tx.receipt.blockNumber);
			expect(checkpoint.totalWeightedStake.toNumber()).to.be.equal(totalStake * MAX_VOTING_WEIGHT);
			expect(checkpoint.numTokens.toNumber()).to.be.equal(amount * 6);

			//check lastFeeWithdrawalTime
			lastFeeWithdrawalTime = await feeSharingProxy.lastFeeWithdrawalTime.call(SOVToken.address);
			block = await web3.eth.getBlock(tx.receipt.blockNumber);
			expect(lastFeeWithdrawalTime.toString()).to.be.equal(block.timestamp.toString());
		});
	});

	describe("withdraw", () => {
		it("Shouldn't be able to withdraw without checkpoints (for token pool)", async () => {
			await expectRevert(
				feeSharingProxy.withdraw(loanToken.address, 0, account2, { from: account1 }),
				"FeeSharingProxy::withdraw: _maxCheckpoints should be positive"
			);
		});

		it("Shouldn't be able to withdraw without checkpoints (for wRBTC pool)", async () => {
			await expectRevert(
				feeSharingProxy.withdraw(loanTokenWrbtc.address, 0, account2, { from: account1 }),
				"FeeSharingProxy::withdraw: _maxCheckpoints should be positive"
			);
		});

		it("Shouldn't be able to withdraw zero amount (for token pool)", async () => {
			let fees = await feeSharingProxy.getAccumulatedFees(account1, loanToken.address);
			expect(fees).to.be.bignumber.equal("0");

			await expectRevert(
				feeSharingProxy.withdraw(loanToken.address, 10, ZERO_ADDRESS, { from: account1 }),
				"FeeSharingProxy::withdrawFees: no tokens for a withdrawal"
			);
		});

		it("Shouldn't be able to withdraw zero amount (for wRBTC pool)", async () => {
			let fees = await feeSharingProxy.getAccumulatedFees(account1, loanTokenWrbtc.address);
			expect(fees).to.be.bignumber.equal("0");

			await expectRevert(
				feeSharingProxy.withdraw(loanTokenWrbtc.address, 10, ZERO_ADDRESS, { from: account1 }),
				"FeeSharingProxy::withdrawFees: no tokens for a withdrawal"
			);
		});

		it("Shouldn't be able to withdraw to another account", async () => {
			//stake - getPriorTotalVotingPower
			let rootStake = 700;
			await stake(rootStake, root);

			let userStake = 300;
			if (MOCK_PRIOR_WEIGHTED_STAKE) {
				await staking.MOCK_priorWeightedStake(userStake * 10);
			}
			await SOVToken.transfer(account1, userStake);
			await stake(userStake, account1);

			//mock data
			let lendingFeeTokensHeld = new BN(wei("1", "ether"))
			let tradingFeeTokensHeld = new BN(wei("2", "ether"))
			let borrowingFeeTokensHeld = new BN(wei("3", "ether"))
			let totalFeeTokensHeld = (lendingFeeTokensHeld.add(tradingFeeTokensHeld)).add(borrowingFeeTokensHeld)
			let feeAmount = await setFeeTokensHeld(lendingFeeTokensHeld, tradingFeeTokensHeld, borrowingFeeTokensHeld);

			await feeSharingProxy.withdrawFees([susd.address]);

			let fees = await feeSharingProxy.getAccumulatedFees(account1, loanTokenWrbtc.address);
			let swapFee = totalFeeTokensHeld.mul(tradingFeePercent).div(new BN(wei("100", "ether")))
			loanTokenWRBTCBalanceShouldBe = (feeAmount.mul(new BN(mockPrice) )).sub(swapFee);
			expect(fees).to.be.bignumber.equal(loanTokenWRBTCBalanceShouldBe.mul(new BN(3)).div(new BN(10)));

			let tx = await feeSharingProxy.withdraw(loanTokenWrbtc.address, 1000, account2, { from: account1 });

			//processedCheckpoints
			let processedCheckpoints = await feeSharingProxy.processedCheckpoints.call(account1, loanTokenWrbtc.address);
			expect(processedCheckpoints.toNumber()).to.be.equal(1);

			expectEvent(tx, "UserFeeWithdrawn", {
				sender: account1,
				receiver: account2,
				token: loanTokenWrbtc.address,
				amount: loanTokenWRBTCBalanceShouldBe.mul(new BN(3)).div(new BN(10)),
			});
		});

		it("Should be able to withdraw (token pool)", async () => {
			//FeeSharingProxy
			feeSharingProxy = await FeeSharingProxyMockup.new(protocol.address, staking.address, wrbtc.address);
			await protocol.setFeesController(feeSharingProxy.address);

			//stake - getPriorTotalVotingPower
			let rootStake = 700;
			await stake(rootStake, root);

			let userStake = 300;
			if (MOCK_PRIOR_WEIGHTED_STAKE) {
				await staking.MOCK_priorWeightedStake(userStake * 10);
			}
			await SOVToken.transfer(account1, userStake);
			await stake(userStake, account1);

			// Mock (transfer loanToken to FeeSharingProxy contract)
			const loanPoolTokenAddress = await protocol.underlyingToLoanPool(susd.address);
			const amountLend = new BN(wei("500", "ether"));
			await susd.approve(loanPoolTokenAddress, amountLend);
			await loanToken.mint(feeSharingProxy.address, amountLend);

			// Check ISUSD Balance for feeSharingProxy
			const feeSharingProxyLoanBalanceToken = await loanToken.balanceOf(feeSharingProxy.address);
			expect(feeSharingProxyLoanBalanceToken.toString()).to.be.equal(amountLend.toString());

			// Withdraw ISUSD from feeSharingProxy
			// const initial 
			await feeSharingProxy.addCheckPoint(loanPoolTokenAddress, amountLend.toString());
			let tx = await feeSharingProxy.trueWithdraw(loanToken.address, 10, ZERO_ADDRESS, { from: account1 });
			const updatedFeeSharingProxyLoanBalanceToken = await loanToken.balanceOf(feeSharingProxy.address);
			const updatedAccount1LoanBalanceToken = await loanToken.balanceOf(account1);
			console.log("\nwithdraw(checkpoints = 1).gasUsed: " + tx.receipt.gasUsed);

			expect(updatedFeeSharingProxyLoanBalanceToken.toString()).to.be.equal( ((amountLend * 7) / 10).toString() );
			expect(updatedAccount1LoanBalanceToken.toString()).to.be.equal( ((amountLend * 3) / 10).toString() );

			expectEvent(tx, "UserFeeWithdrawn", {
				sender: account1,
				receiver: account1,
				token: loanToken.address,
				amount: amountLend.mul(new BN(3)).div(new BN(10)),
			});
		});

		it("Should be able to withdraw (wrbtc pool)", async () => {
			//stake - getPriorTotalVotingPower
			let rootStake = 700;
			await stake(rootStake, root);

			let userStake = 300;
			if (MOCK_PRIOR_WEIGHTED_STAKE) {
				await staking.MOCK_priorWeightedStake(userStake * 10);
			}
			await SOVToken.transfer(account1, userStake);
			await stake(userStake, account1);

			//mock data
			let lendingFeeTokensHeld = new BN(wei("1", "gwei"))
			let tradingFeeTokensHeld = new BN(wei("2", "gwei"))
			let borrowingFeeTokensHeld = new BN(wei("3", "gwei"))
			let totalFeeTokensHeld = (lendingFeeTokensHeld.add(tradingFeeTokensHeld)).add(borrowingFeeTokensHeld)
			let feeAmount = await setFeeTokensHeld(lendingFeeTokensHeld, tradingFeeTokensHeld, borrowingFeeTokensHeld);

			await feeSharingProxy.withdrawFees([susd.address]);

			let fees = await feeSharingProxy.getAccumulatedFees(account1, loanTokenWrbtc.address);
			let swapFee = totalFeeTokensHeld.mul(tradingFeePercent).div(new BN(wei("100", "ether")))
			loanTokenWRBTCBalanceShouldBe = (feeAmount.mul(new BN(mockPrice) )).sub(swapFee);
			expect(fees).to.be.bignumber.equal(loanTokenWRBTCBalanceShouldBe.mul(new BN(3)).div(new BN(10)));

			let userInitialBtcBalance = new BN(await web3.eth.getBalance(account1));
			let tx = await feeSharingProxy.withdraw(loanTokenWrbtc.address, 10, ZERO_ADDRESS, { from: account1 });
			console.log("\nwithdraw(checkpoints = 1).gasUsed: " + tx.receipt.gasUsed);
			let txFee = 8000000000*tx.receipt.gasUsed;

			userInitialBtcBalance = userInitialBtcBalance.sub(new BN(txFee));
			//processedCheckpoints
			let processedCheckpoints = await feeSharingProxy.processedCheckpoints.call(account1, loanTokenWrbtc.address);
			expect(processedCheckpoints.toNumber()).to.be.equal(1);

			//check balances
			let feeSharingProxyBalance = await loanTokenWrbtc.balanceOf.call(feeSharingProxy.address);
			expect(feeSharingProxyBalance.toNumber()).to.be.equal((loanTokenWRBTCBalanceShouldBe * 7) / 10);
			let userLoanTokenBalance = await loanTokenWrbtc.balanceOf.call(account1);
			expect(userLoanTokenBalance.toNumber()).to.be.equal(0);

			let userLatestBTCBalance = new BN(await web3.eth.getBalance(account1));
			expect(userLatestBTCBalance.toString()).to.be.equal( (userInitialBtcBalance.add( loanTokenWRBTCBalanceShouldBe.mul( new BN(3) ).div( new BN(10) ))).toString() );

			expectEvent(tx, "UserFeeWithdrawn", {
				sender: account1,
				receiver: account1,
				token: loanTokenWrbtc.address,
				amount: loanTokenWRBTCBalanceShouldBe.mul(new BN(3)).div(new BN(10)),
			});
		});

		it("Should be able to withdraw using 3 checkpoints", async () => {
			//stake - getPriorTotalVotingPower
			let rootStake = 900;
			await stake(rootStake, root);

			let userStake = 100;
			if (MOCK_PRIOR_WEIGHTED_STAKE) {
				await staking.MOCK_priorWeightedStake(userStake * 10);
			}
			await SOVToken.transfer(account1, userStake);
			await stake(userStake, account1);

			// [FIRST]
			//mock data
			let lendingFeeTokensHeld = new BN(wei("1", "gwei"))
			let tradingFeeTokensHeld = new BN(wei("2", "gwei"))
			let borrowingFeeTokensHeld = new BN(wei("3", "gwei"))
			let totalFeeTokensHeld = (lendingFeeTokensHeld.add(tradingFeeTokensHeld)).add(borrowingFeeTokensHeld)
			let feeAmount = await setFeeTokensHeld(lendingFeeTokensHeld, tradingFeeTokensHeld, borrowingFeeTokensHeld);
			await feeSharingProxy.withdrawFees([susd.address]);

			let swapFee = totalFeeTokensHeld.mul(tradingFeePercent).div(new BN(wei("100", "ether")))
			let loanTokenWRBTCBalanceShouldBe = (feeAmount.mul(new BN(mockPrice) )).sub(swapFee);
			let totalLoanTokenWRBTCBalanceShouldBe = loanTokenWRBTCBalanceShouldBe

			let userInitialBtcBalance = new BN(await web3.eth.getBalance(account1));
			let tx = await feeSharingProxy.withdraw(loanTokenWrbtc.address, 1, ZERO_ADDRESS, { from: account1 });
			console.log("\nwithdraw(checkpoints = 1).gasUsed: " + tx.receipt.gasUsed);
			let txFee = 8000000000*tx.receipt.gasUsed;

			userInitialBtcBalance = userInitialBtcBalance.sub(new BN(txFee));
			//processedCheckpoints
			let processedCheckpoints = await feeSharingProxy.processedCheckpoints.call(account1, loanTokenWrbtc.address);
			expect(processedCheckpoints.toNumber()).to.be.equal(1);

			//check balances
			let feeSharingProxyBalance = await loanTokenWrbtc.balanceOf.call(feeSharingProxy.address);
			expect(feeSharingProxyBalance.toNumber()).to.be.equal((totalLoanTokenWRBTCBalanceShouldBe * 9) / 10);
			let userBalance = await loanTokenWrbtc.balanceOf.call(account1);
			expect(userBalance.toNumber()).to.be.equal(0);

			let userLatestBTCBalance = new BN(await web3.eth.getBalance(account1));
			expect(userLatestBTCBalance.toString()).to.be.equal( (userInitialBtcBalance.add( loanTokenWRBTCBalanceShouldBe.mul( new BN(1) ).div( new BN(10) ))).toString() );


			// [SECOND]
			//mock data
			let lendingFeeTokensHeld2 = new BN(wei("1", "gwei"))
			let tradingFeeTokensHeld2 = new BN(wei("2", "gwei"))
			let borrowingFeeTokensHeld2 = new BN(wei("3", "gwei"))
			totalFeeTokensHeld = (lendingFeeTokensHeld2.add(tradingFeeTokensHeld2)).add(borrowingFeeTokensHeld2)
			feeAmount = await setFeeTokensHeld(lendingFeeTokensHeld2, tradingFeeTokensHeld2, borrowingFeeTokensHeld2);
			await increaseTime(FEE_WITHDRAWAL_INTERVAL);
			await feeSharingProxy.withdrawFees([susd.address]);

			swapFee = totalFeeTokensHeld.mul(tradingFeePercent).div(new BN(wei("100", "ether")))
			loanTokenWRBTCBalanceShouldBe = (feeAmount.mul(new BN(mockPrice) )).sub(swapFee);
			totalLoanTokenWRBTCBalanceShouldBe = totalLoanTokenWRBTCBalanceShouldBe.add(loanTokenWRBTCBalanceShouldBe)
			let totalLoanTokenWRBTCBalanceShouldBeAccount1 = loanTokenWRBTCBalanceShouldBe

			// [THIRD]
			//mock data
			let lendingFeeTokensHeld3 = new BN(wei("1", "gwei"))
			let tradingFeeTokensHeld3 = new BN(wei("2", "gwei"))
			let borrowingFeeTokensHeld3 = new BN(wei("3", "gwei"))
			totalFeeTokensHeld = (lendingFeeTokensHeld3.add(tradingFeeTokensHeld3)).add(borrowingFeeTokensHeld3)
			feeAmount = await setFeeTokensHeld(lendingFeeTokensHeld3, tradingFeeTokensHeld3, borrowingFeeTokensHeld3);
			await increaseTime(FEE_WITHDRAWAL_INTERVAL);
			await feeSharingProxy.withdrawFees([susd.address]);

			swapFee = totalFeeTokensHeld.mul(tradingFeePercent).div(new BN(wei("100", "ether")))
			loanTokenWRBTCBalanceShouldBe = (feeAmount.mul(new BN(mockPrice) )).sub(swapFee);
			totalLoanTokenWRBTCBalanceShouldBe = totalLoanTokenWRBTCBalanceShouldBe.add(loanTokenWRBTCBalanceShouldBe)
			totalLoanTokenWRBTCBalanceShouldBeAccount1 = totalLoanTokenWRBTCBalanceShouldBeAccount1.add(loanTokenWRBTCBalanceShouldBe)

			// [SECOND] - [THIRD]
			userInitialBtcBalance = new BN(await web3.eth.getBalance(account1));
			tx = await feeSharingProxy.withdraw(loanTokenWrbtc.address, 2, ZERO_ADDRESS, { from: account1 });
			console.log("\nwithdraw(checkpoints = 2).gasUsed: " + tx.receipt.gasUsed);
			txFee = 8000000000*tx.receipt.gasUsed;

			userInitialBtcBalance = userInitialBtcBalance.sub(new BN(txFee));

			//processedCheckpoints
			processedCheckpoints = await feeSharingProxy.processedCheckpoints.call(account1, loanTokenWrbtc.address);
			expect(processedCheckpoints.toNumber()).to.be.equal(3);

			//check balances
			feeSharingProxyBalance = await loanTokenWrbtc.balanceOf.call(feeSharingProxy.address);
			expect(feeSharingProxyBalance.toNumber()).to.be.equal(parseInt((totalLoanTokenWRBTCBalanceShouldBe * 9) / 10));
			userBalance = await loanTokenWrbtc.balanceOf.call(account1);
			expect(userBalance.toNumber()).to.be.equal(0);

			userLatestBTCBalance = new BN(await web3.eth.getBalance(account1));

			expect(userLatestBTCBalance.toString()).to.be.equal( (userInitialBtcBalance.add( totalLoanTokenWRBTCBalanceShouldBeAccount1.mul( new BN(1) ).div( new BN(10) ))).toString() );
		});

		it("Should be able to process 10 checkpoints", async () => {
			//stake - getPriorTotalVotingPower
			await stake(900, root);
			let userStake = 100;
			if (MOCK_PRIOR_WEIGHTED_STAKE) {
				await staking.MOCK_priorWeightedStake(userStake * 10);
			}
			await SOVToken.transfer(account1, userStake);
			await stake(userStake, account1);

			//mock data
			await createCheckpoints(10);

			let tx = await feeSharingProxy.withdraw(loanTokenWrbtc.address, 1000, ZERO_ADDRESS, { from: account1 });
			console.log("\nwithdraw(checkpoints = 10).gasUsed: " + tx.receipt.gasUsed);
			//processedCheckpoints
			let processedCheckpoints = await feeSharingProxy.processedCheckpoints.call(account1, loanTokenWrbtc.address);
			expect(processedCheckpoints.toNumber()).to.be.equal(10);
		});

		it("Should be able to process 10 checkpoints and 3 withdrawal", async () => {
			//stake - getPriorTotalVotingPower
			await stake(900, root);
			let userStake = 100;
			if (MOCK_PRIOR_WEIGHTED_STAKE) {
				await staking.MOCK_priorWeightedStake(userStake * 10);
			}
			await SOVToken.transfer(account1, userStake);
			await stake(userStake, account1);

			//mock data
			await createCheckpoints(10);

			let tx = await feeSharingProxy.withdraw(loanTokenWrbtc.address, 5, ZERO_ADDRESS, { from: account1 });
			console.log("\nwithdraw(checkpoints = 5).gasUsed: " + tx.receipt.gasUsed);
			//processedCheckpoints
			let processedCheckpoints = await feeSharingProxy.processedCheckpoints.call(account1, loanTokenWrbtc.address);
			expect(processedCheckpoints.toNumber()).to.be.equal(5);

			tx = await feeSharingProxy.withdraw(loanTokenWrbtc.address, 3, ZERO_ADDRESS, { from: account1 });
			console.log("\nwithdraw(checkpoints = 3).gasUsed: " + tx.receipt.gasUsed);
			//processedCheckpoints
			processedCheckpoints = await feeSharingProxy.processedCheckpoints.call(account1, loanTokenWrbtc.address);
			expect(processedCheckpoints.toNumber()).to.be.equal(8);

			tx = await feeSharingProxy.withdraw(loanTokenWrbtc.address, 1000, ZERO_ADDRESS, { from: account1 });
			console.log("\nwithdraw(checkpoints = 2).gasUsed: " + tx.receipt.gasUsed);
			//processedCheckpoints
			processedCheckpoints = await feeSharingProxy.processedCheckpoints.call(account1, loanTokenWrbtc.address);
			expect(processedCheckpoints.toNumber()).to.be.equal(10);
		});

		//use for gas usage tests
		// it("Should be able to process 30 checkpoints", async () => {
		//     //stake - getPriorTotalVotingPower
		//     await stake(900, root);
		//     let userStake = 100;
		//     if (MOCK_PRIOR_WEIGHTED_STAKE) {
		//         await staking.MOCK_priorWeightedStake(userStake * 10);
		//     }
		//     await SOVToken.transfer(account1, userStake);
		//     await stake(userStake, account1);
		//
		//     //mock data
		//     await createCheckpoints(30);
		//
		//     let tx = await feeSharingProxy.withdraw(loanToken.address, 1000, ZERO_ADDRESS, {from: account1});
		//     console.log("\nwithdraw(checkpoints = 30).gasUsed: " + tx.receipt.gasUsed);
		//     //processedCheckpoints
		//     let processedCheckpoints = await feeSharingProxy.processedCheckpoints.call(account1, loanToken.address);
		//     expect(processedCheckpoints.toNumber()).to.be.equal(30);
		// });
		//
		//use for gas usage tests
		// it("Should be able to process 100 checkpoints", async () => {
		//     //stake - getPriorTotalVotingPower
		//     await stake(900, root);
		//     let userStake = 100;
		//     if (MOCK_PRIOR_WEIGHTED_STAKE) {
		//         await staking.MOCK_priorWeightedStake(userStake * 10);
		//     }
		//     await SOVToken.transfer(account1, userStake);
		//     await stake(userStake, account1);
		//
		//     //mock data
		//     await createCheckpoints(100);
		//
		//     let tx = await feeSharingProxy.withdraw(loanToken.address, 1000, ZERO_ADDRESS, {from: account1});
		//     console.log("\nwithdraw(checkpoints = 500).gasUsed: " + tx.receipt.gasUsed);
		//     //processedCheckpoints
		//     let processedCheckpoints = await feeSharingProxy.processedCheckpoints.call(account1, loanToken.address);
		//     expect(processedCheckpoints.toNumber()).to.be.equal(100);
		// });
		//
		//use for gas usage tests
		// it("Should be able to withdraw when staking contains a lot of checkpoints", async () => {
		//     let checkpointCount = 1000;
		//     await stake(1000, root, checkpointCount);
		//     let afterBlock = await blockNumber();
		//     console.log(afterBlock);
		//
		//     let kickoffTS = await staking.kickoffTS.call();
		//     let stakingDate = kickoffTS.add(new BN(MAX_DURATION));
		//
		//     let numUserStakingCheckpoints = await staking.numUserStakingCheckpoints.call(root, stakingDate);
		//     let firstCheckpoint = await staking.userStakingCheckpoints.call(root, stakingDate, 0);
		//     let lastCheckpoint = await staking.userStakingCheckpoints.call(root, stakingDate, numUserStakingCheckpoints - 1);
		//     let block1 = firstCheckpoint.fromBlock.toNumber() + 1;
		//     let block2 = lastCheckpoint.fromBlock;
		//
		//     console.log("numUserStakingCheckpoints = " + numUserStakingCheckpoints.toString());
		//     console.log("first = " + firstCheckpoint.fromBlock.toString());
		//     console.log("last = " + lastCheckpoint.fromBlock.toString());
		//
		//     let tx = await staking.calculatePriorWeightedStake(root, block1, stakingDate);
		//     console.log("\ncalculatePriorWeightedStake(checkpoints = " + checkpointCount + ").gasUsed: " + tx.receipt.gasUsed);
		//     tx = await staking.calculatePriorWeightedStake(root, block2, stakingDate);
		//     console.log("\ncalculatePriorWeightedStake(checkpoints = " + checkpointCount + ").gasUsed: " + tx.receipt.gasUsed);
		// });

		it("Should be able to withdraw with staking for 78 dates", async () => {
			//stake - getPriorTotalVotingPower
			let rootStake = 700;
			await stake(rootStake, root);

			let userStake = 300;
			if (MOCK_PRIOR_WEIGHTED_STAKE) {
				await staking.MOCK_priorWeightedStake(userStake * 10);
			}
			await SOVToken.transfer(account1, userStake);
			await stake(userStake, account1);

			let kickoffTS = await staking.kickoffTS.call();
			await SOVToken.approve(staking.address, userStake * 1000);
			for (let i = 0; i < 77; i++) {
				let stakingDate = kickoffTS.add(new BN(TWO_WEEKS * (i + 1)));
				await staking.stake(userStake, stakingDate, account1, account1);
			}

			//mock data
			await setFeeTokensHeld(new BN(100), new BN(200), new BN(300));

			await feeSharingProxy.withdrawFees([susd.address]);

			let tx = await feeSharingProxy.withdraw(loanTokenWrbtc.address, 10, ZERO_ADDRESS, { from: account1 });
			console.log("\nwithdraw(checkpoints = 1).gasUsed: " + tx.receipt.gasUsed);
		});

		it("should compute the weighted stake and show gas usage", async () => {
			await stake(100, root);
			let kickoffTS = await staking.kickoffTS.call();
			let stakingDate = kickoffTS.add(new BN(MAX_DURATION));
			await SOVToken.approve(staking.address, 100);
			let result = await staking.stake("100", stakingDate, root, root);
			await mineBlock();

			let tx = await staking.calculatePriorWeightedStake(root, result.receipt.blockNumber, stakingDate);
			console.log("\ngasUsed: " + tx.receipt.gasUsed);
		});
	});

	async function stake(amount, user, checkpointCount) {
		await SOVToken.approve(staking.address, amount);
		let kickoffTS = await staking.kickoffTS.call();
		let stakingDate = kickoffTS.add(new BN(MAX_DURATION));
		let tx = await staking.stake(amount, stakingDate, user, user);
		await mineBlock();

		if (checkpointCount > 0) {
			await increaseStake(amount, user, stakingDate, checkpointCount - 1);
		}

		return tx;
	}

	async function increaseStake(amount, user, stakingDate, checkpointCount) {
		for (let i = 0; i < checkpointCount; i++) {
			await SOVToken.approve(staking.address, amount);
			await staking.increaseStake(amount, user, stakingDate);
		}
	}

	async function setFeeTokensHeld(lendingFee, tradingFee, borrowingFee) {
		let totalFeeAmount = lendingFee.add(tradingFee).add(borrowingFee);
		await susd.transfer(protocol.address, totalFeeAmount);
		await protocol.setLendingFeeTokensHeld(susd.address, lendingFee);
		await protocol.setTradingFeeTokensHeld(susd.address, tradingFee);
		await protocol.setBorrowingFeeTokensHeld(susd.address, borrowingFee);
		return totalFeeAmount;
	}

	async function checkWithdrawFee(swapFee) {
		let protocolBalance = await susd.balanceOf(protocol.address);
		expect(protocolBalance.toNumber()).to.be.equal(swapFee.toNumber());
		let lendingFeeTokensHeld = await protocol.lendingFeeTokensHeld.call(susd.address);
		expect(lendingFeeTokensHeld.toNumber()).to.be.equal(0);
		let tradingFeeTokensHeld = await protocol.tradingFeeTokensHeld.call(susd.address);
		expect(tradingFeeTokensHeld.toNumber()).to.be.equal(swapFee.toNumber());
		let borrowingFeeTokensHeld = await protocol.borrowingFeeTokensHeld.call(susd.address);
		expect(borrowingFeeTokensHeld.toNumber()).to.be.equal(0);
	}

	async function checkWithdrawFeeAfterPriceChanged(swapFee, priceMultiplier) {
		let protocolBalance = await susd.balanceOf(protocol.address);
		expect(protocolBalance.toNumber()).to.be.equal((swapFee.mul(priceMultiplier)).toNumber());
		let lendingFeeTokensHeld = await protocol.lendingFeeTokensHeld.call(susd.address);
		expect(lendingFeeTokensHeld.toNumber()).to.be.equal(0);
		let tradingFeeTokensHeld = await protocol.tradingFeeTokensHeld.call(susd.address);
		expect(tradingFeeTokensHeld.toNumber()).to.be.equal(swapFee.toNumber());
		let borrowingFeeTokensHeld = await protocol.borrowingFeeTokensHeld.call(susd.address);
		expect(borrowingFeeTokensHeld.toNumber()).to.be.equal(0);
	}

	async function createCheckpoints(number) {
		for (let i = 0; i < number; i++) {
			await setFeeTokensHeld(new BN(100), new BN(200), new BN(300));
			await increaseTime(FEE_WITHDRAWAL_INTERVAL);
			await feeSharingProxy.withdrawFees([susd.address]);
		}
	}
});
