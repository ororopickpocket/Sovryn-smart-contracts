const { expect } = require("chai");
const { expectRevert, expectEvent, constants, BN, balance, time } = require("@openzeppelin/test-helpers");

const {
	address,
	minerStart,
	minerStop,
	unlockedAccount,
	mineBlock,
	etherMantissa,
	etherUnsigned,
	setTime,
	increaseTime,
	setNextBlockTimestamp,
	advanceBlocks,
} = require("../Utils/Ethereum");

const StakingLogic = artifacts.require("Staking");
const StakingProxy = artifacts.require("StakingProxy");
const StakingMockup = artifacts.require("StakingMockup");

const SOV = artifacts.require("SOV");
const TestToken = artifacts.require("TestToken");
const TestWrbtc = artifacts.require("TestWrbtc");

const Protocol = artifacts.require("sovrynProtocol");
const ProtocolSettings = artifacts.require("ProtocolSettingsMockup");
const LoanMaintenance = artifacts.require("LoanMaintenance");
const LoanSettings = artifacts.require("LoanSettings");
const LoanOpenings = artifacts.require("LoanOpenings");
const LoanClosingsBase = artifacts.require("LoanClosingsBase");
const LoanClosingsWith = artifacts.require("LoanClosingsWith");

const LoanTokenLogic = artifacts.require("LoanTokenLogicStandard");
const LoanTokenSettings = artifacts.require("LoanTokenSettingsLowerAdmin");
const LoanToken = artifacts.require("LoanToken");

const FeeSharingProxy = artifacts.require("FeeSharingProxy");

const TOTAL_SUPPLY = "100000000000000000000000000000";
const MAX_DURATION = new BN(24 * 60 * 60).mul(new BN(1092));

const DAY = 86400;
const TWO_WEEKS = 1209600;

const DELAY = 86400 * 14;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

contract("Staking", (accounts) => {
	const name = "Test token";
	const symbol = "TST";

	let root, account1, account2, account3;
	let token, susd, wrbtc, staking;
	let protocol;
	let loanTokenSettings, loanTokenLogic, loanToken;
	let feeSharingProxy;
	let kickoffTS, inOneWeek;

	before(async () => {
		[root, account1, account2, account3, ...accounts] = accounts;
	});

	beforeEach(async () => {
		//Token
		token = await SOV.new(TOTAL_SUPPLY);
		susd = await TestToken.new("SUSD", "SUSD", 18, TOTAL_SUPPLY);
		wrbtc = await TestWrbtc.new();

		//staking
		let stakingLogic = await StakingMockup.new(token.address);
		staking = await StakingProxy.new(token.address);
		await staking.setImplementation(stakingLogic.address);
		staking = await StakingMockup.at(staking.address);

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
		// await loanToken.initialize(susd.address, "iSUSD", "iSUSD");
		loanToken = await LoanTokenLogic.at(loanToken.address);

		await protocol.setLoanPool([loanToken.address], [susd.address]);

		//FeeSharingProxy
		feeSharingProxy = await FeeSharingProxy.new(protocol.address, staking.address);
		await protocol.setFeesController(feeSharingProxy.address);
		await staking.setFeeSharing(feeSharingProxy.address);

		await token.transfer(account1, 1000);
		await token.approve(staking.address, TOTAL_SUPPLY);
		kickoffTS = await staking.kickoffTS.call();
		inOneWeek = kickoffTS.add(new BN(DELAY));
	});

	describe("stake", () => {
		it("Amount should be positive", async () => {
			await expectRevert(staking.stake(0, inOneWeek, root, root), "amount of tokens to stake needs to be bigger than 0");
		});

		it("Amount should be approved", async () => {
			await expectRevert(staking.stake(100, inOneWeek, root, root, { from: account1 }), "ERC20: transfer amount exceeds allowance");
		});

		it("Staking period too short", async () => {
			await expectRevert(
				staking.stake(100, await getTimeFromKickoff(DAY), root, root),
				"Staking::timestampToLockDate: staking period too short"
			);
		});

		it("Shouldn't be able to stake longer than max duration", async () => {
			let amount = "100";
			let lockedTS = await getTimeFromKickoff(MAX_DURATION);
			let tx = await staking.stake(amount, lockedTS, account1, account1);

			expectEvent(tx, "TokensStaked", {
				staker: account1,
				amount: amount,
				lockedUntil: lockedTS,
				totalStaked: amount,
			});

			expectEvent(tx, "DelegateChanged", {
				delegator: account1,
				fromDelegate: ZERO_ADDRESS,
				toDelegate: account1,
			});
		});

		it("Sender should be used if zero addresses passed", async () => {
			let amount = "100";
			let lockedTS = await getTimeFromKickoff(MAX_DURATION);
			let tx = await staking.stake(amount, lockedTS, ZERO_ADDRESS, ZERO_ADDRESS);

			expectEvent(tx, "TokensStaked", {
				staker: root,
				amount: amount,
				lockedUntil: lockedTS,
				totalStaked: amount,
			});

			expectEvent(tx, "DelegateChanged", {
				delegator: root,
				fromDelegate: ZERO_ADDRESS,
				toDelegate: root,
			});
		});

		it("Should be able to stake and delegate for yourself", async () => {
			let amount = "100";
			let duration = TWO_WEEKS;
			let lockedTS = await getTimeFromKickoff(duration);

			let stackingbBalance = await token.balanceOf.call(staking.address);
			expect(stackingbBalance.toNumber()).to.be.equal(0);
			let beforeBalance = await token.balanceOf.call(root);

			let tx = await staking.stake(amount, lockedTS, root, root);

			stackingbBalance = await token.balanceOf.call(staking.address);
			expect(stackingbBalance.toString()).to.be.equal(amount);
			let afterBalance = await token.balanceOf.call(root);
			expect(beforeBalance.sub(afterBalance).toString()).to.be.equal(amount);

			//_writeUserCheckpoint
			let numUserCheckpoints = await staking.numUserStakingCheckpoints.call(root, lockedTS);
			expect(numUserCheckpoints.toNumber()).to.be.equal(1);
			let checkpoint = await staking.userStakingCheckpoints.call(root, lockedTS, 0);
			expect(checkpoint.fromBlock.toNumber()).to.be.equal(tx.receipt.blockNumber);
			expect(checkpoint.stake.toString()).to.be.equal(amount);

			//_increaseDailyStake
			let numTotalStakingCheckpoints = await staking.numTotalStakingCheckpoints.call(lockedTS);
			expect(numTotalStakingCheckpoints.toNumber()).to.be.equal(1);
			checkpoint = await staking.totalStakingCheckpoints.call(lockedTS, 0);
			expect(checkpoint.fromBlock.toNumber()).to.be.equal(tx.receipt.blockNumber);
			expect(checkpoint.stake.toString()).to.be.equal(amount);

			//_delegate
			let delegator = await staking.delegates.call(root, lockedTS);
			expect(delegator).to.be.equal(root);

			let numDelegateStakingCheckpoints = await staking.numDelegateStakingCheckpoints.call(root, lockedTS);
			expect(numDelegateStakingCheckpoints.toNumber()).to.be.equal(1);
			checkpoint = await staking.delegateStakingCheckpoints.call(root, lockedTS, 0);
			expect(checkpoint.fromBlock.toNumber()).to.be.equal(tx.receipt.blockNumber);
			expect(checkpoint.stake.toString()).to.be.equal(amount);

			expectEvent(tx, "TokensStaked", {
				staker: root,
				amount: amount,
				lockedUntil: lockedTS,
				totalStaked: amount,
			});

			expectEvent(tx, "DelegateChanged", {
				delegator: root,
				fromDelegate: ZERO_ADDRESS,
				toDelegate: root,
			});
		});

		it("Should be able to stake and delegate for another person", async () => {
			let amount = "1000";
			let duration = new BN(TWO_WEEKS).mul(new BN(2));
			let lockedTS = await getTimeFromKickoff(duration);

			let tx = await staking.stake(amount, lockedTS, account1, account1);

			//_writeUserCheckpoint
			let numUserCheckpoints = await staking.numUserStakingCheckpoints.call(account1, lockedTS);
			expect(numUserCheckpoints.toNumber()).to.be.equal(1);
			let checkpoint = await staking.userStakingCheckpoints.call(account1, lockedTS, 0);
			expect(checkpoint.fromBlock.toNumber()).to.be.equal(tx.receipt.blockNumber);
			expect(checkpoint.stake.toString()).to.be.equal(amount);

			//_increaseDailyStake
			let numTotalStakingCheckpoints = await staking.numTotalStakingCheckpoints.call(lockedTS);
			expect(numTotalStakingCheckpoints.toNumber()).to.be.equal(1);
			checkpoint = await staking.totalStakingCheckpoints.call(lockedTS, 0);
			expect(checkpoint.fromBlock.toNumber()).to.be.equal(tx.receipt.blockNumber);
			expect(checkpoint.stake.toString()).to.be.equal(amount);

			//_delegate
			let delegator = await staking.delegates.call(account1, lockedTS);
			expect(delegator).to.be.equal(account1);

			let numDelegateStakingCheckpoints = await staking.numDelegateStakingCheckpoints.call(account1, lockedTS);
			expect(numDelegateStakingCheckpoints.toNumber()).to.be.equal(1);
			checkpoint = await staking.delegateStakingCheckpoints.call(account1, lockedTS, 0);
			expect(checkpoint.fromBlock.toNumber()).to.be.equal(tx.receipt.blockNumber);
			expect(checkpoint.stake.toString()).to.be.equal(amount);

			expectEvent(tx, "TokensStaked", {
				staker: account1,
				amount: amount,
				lockedUntil: lockedTS,
				totalStaked: amount,
			});

			expectEvent(tx, "DelegateChanged", {
				delegator: account1,
				fromDelegate: ZERO_ADDRESS,
				toDelegate: account1,
			});
		});

		it("Should be able to stake after withdrawing whole amount", async () => {
			let amount = "1000";
			let duration = new BN(TWO_WEEKS).mul(new BN(2));
			let lockedTS = await getTimeFromKickoff(duration);
			await staking.stake(amount, lockedTS, root, root);

			//await setTime(lockedTS);
			setNextBlockTimestamp(lockedTS.toNumber());

			let stackingbBalance = await token.balanceOf.call(staking.address);
			expect(stackingbBalance.toString()).to.be.equal(amount);

			await staking.withdraw(amount, lockedTS, root);

			stackingbBalance = await token.balanceOf.call(staking.address);
			expect(stackingbBalance.toNumber()).to.be.equal(0);

			//stake second time
			lockedTS = await getTimeFromKickoff(duration * 2);
			let tx = await staking.stake(amount * 2, lockedTS, root, root);

			stackingbBalance = await token.balanceOf.call(staking.address);
			expect(stackingbBalance.toNumber()).to.be.equal(amount * 2);

			//_writeUserCheckpoint
			let numUserCheckpoints = await staking.numUserStakingCheckpoints.call(root, lockedTS);
			expect(numUserCheckpoints.toNumber()).to.be.equal(1);
			let checkpoint = await staking.userStakingCheckpoints.call(root, lockedTS, 0);
			expect(checkpoint.fromBlock.toNumber()).to.be.equal(tx.receipt.blockNumber);
			expect(checkpoint.stake.toNumber()).to.be.equal(amount * 2);
		});

		it("Should be able to stake after withdrawing amount partially", async () => {
			let amount = "1000";
			let duration = new BN(TWO_WEEKS).mul(new BN(2));
			let lockedTS = await getTimeFromKickoff(duration);

			let bb = await token.balanceOf.call(root);

			await staking.stake(amount, lockedTS, root, root);

			//await setTime(lockedTS);
			setNextBlockTimestamp(lockedTS.toNumber());
			blockTimestamp = (await ethers.provider.getBlock("latest")).timestamp;

			let stackingbBalance = await token.balanceOf.call(staking.address);
			expect(stackingbBalance.toString()).to.be.equal(amount);
			let beforeBalance = await token.balanceOf.call(root);

			await staking.withdraw(amount / 2, lockedTS, root);

			stackingbBalance = await token.balanceOf.call(staking.address);
			expect(stackingbBalance.toNumber()).to.be.equal(amount / 2);
			let afterBalance = await token.balanceOf.call(root);

			expect(afterBalance.sub(beforeBalance).toNumber()).to.be.equal(amount / 2);

			//increase stake
			lockedTS = await getTimeFromKickoff(duration * 2);
			let tx = await staking.stake(amount * 2.5, lockedTS, root, root);

			stackingbBalance = await token.balanceOf.call(staking.address);
			expect(stackingbBalance.toNumber()).to.be.equal(amount * 3);

			//_writeUserCheckpoint
			let numUserCheckpoints = await staking.numUserStakingCheckpoints.call(root, lockedTS);
			expect(numUserCheckpoints.toNumber()).to.be.equal(1);
			let checkpoint = await staking.userStakingCheckpoints.call(root, lockedTS, 0);
			expect(checkpoint.fromBlock.toNumber()).to.be.equal(tx.receipt.blockNumber);
			expect(checkpoint.stake.toNumber()).to.be.equal(amount * 2.5);
		});
	});

	describe("stakeWithApproval", () => {
		it("Should be able to stake and delegate for yourself", async () => {
			let amount = "100";
			let duration = TWO_WEEKS;
			let lockedTS = await getTimeFromKickoff(duration);

			let stackingbBalance = await token.balanceOf.call(staking.address);
			expect(stackingbBalance.toNumber()).to.be.equal(0);
			let beforeBalance = await token.balanceOf.call(root);

			await token.approve(staking.address, 0);

			//TODO
			await token.approve(staking.address, amount * 2, { from: account1 });

			let contract = new web3.eth.Contract(staking.abi, staking.address);
			let sender = root;
			let data = contract.methods.stakeWithApproval(sender, amount, lockedTS, root, root).encodeABI();
			// let data = contract.methods.stakeWithApproval(account1, amount * 2, lockedTS, root, root).encodeABI();
			let tx = await token.approveAndCall(staking.address, amount, data, { from: sender });

			stackingbBalance = await token.balanceOf.call(staking.address);
			expect(stackingbBalance.toString()).to.be.equal(amount);
			let afterBalance = await token.balanceOf.call(root);
			expect(beforeBalance.sub(afterBalance).toString()).to.be.equal(amount);

			//_writeUserCheckpoint
			let numUserCheckpoints = await staking.numUserStakingCheckpoints.call(root, lockedTS);
			expect(numUserCheckpoints.toNumber()).to.be.equal(1);
			let checkpoint = await staking.userStakingCheckpoints.call(root, lockedTS, 0);
			expect(checkpoint.fromBlock.toNumber()).to.be.equal(tx.receipt.blockNumber);
			expect(checkpoint.stake.toString()).to.be.equal(amount);

			//_increaseDailyStake
			let numTotalStakingCheckpoints = await staking.numTotalStakingCheckpoints.call(lockedTS);
			expect(numTotalStakingCheckpoints.toNumber()).to.be.equal(1);
			checkpoint = await staking.totalStakingCheckpoints.call(lockedTS, 0);
			expect(checkpoint.fromBlock.toNumber()).to.be.equal(tx.receipt.blockNumber);
			expect(checkpoint.stake.toString()).to.be.equal(amount);

			//_delegate
			let delegator = await staking.delegates.call(root, lockedTS);
			expect(delegator).to.be.equal(root);

			let numDelegateStakingCheckpoints = await staking.numDelegateStakingCheckpoints.call(root, lockedTS);
			expect(numDelegateStakingCheckpoints.toNumber()).to.be.equal(1);
			checkpoint = await staking.delegateStakingCheckpoints.call(root, lockedTS, 0);
			expect(checkpoint.fromBlock.toNumber()).to.be.equal(tx.receipt.blockNumber);
			expect(checkpoint.stake.toString()).to.be.equal(amount);
		});

		it("fails if invoked directly", async () => {
			let lockedTS = await getTimeFromKickoff(TWO_WEEKS);
			await expectRevert(staking.stakeWithApproval(root, "100", lockedTS, root, root), "unauthorized");
		});

		it("fails if wrong method passed in data", async () => {
			let amount = "100";
			let lockedTS = await getTimeFromKickoff(TWO_WEEKS);
			let contract = new web3.eth.Contract(staking.abi, staking.address);
			let data = contract.methods.stake(amount, lockedTS, root, root).encodeABI();

			await expectRevert(token.approveAndCall(staking.address, amount, data), "method is not allowed");
		});

		it("fails if wrong sender passed in data", async () => {
			let amount = "100";
			let lockedTS = await getTimeFromKickoff(TWO_WEEKS);
			let contract = new web3.eth.Contract(staking.abi, staking.address);

			await token.approve(staking.address, amount * 2, { from: account1 });
			let sender = root;
			let data = contract.methods.stakeWithApproval(account1, amount, lockedTS, root, root).encodeABI();

			await expectRevert(token.approveAndCall(staking.address, amount, data, { from: sender }), "sender mismatch");
		});

		it("fails if wrong amount passed in data", async () => {
			let amount = "100";
			let lockedTS = await getTimeFromKickoff(TWO_WEEKS);
			let contract = new web3.eth.Contract(staking.abi, staking.address);

			await token.approve(staking.address, amount * 2, { from: account1 });
			let sender = root;
			let data = contract.methods.stakeWithApproval(sender, amount, lockedTS, root, root).encodeABI();

			await expectRevert(token.approveAndCall(staking.address, amount * 2, data, { from: sender }), "amount mismatch");
		});
	});

	describe("extendStakingDuration", () => {
		it("Cannot reduce the staking duration", async () => {
			let amount = "1000";
			let duration = new BN(TWO_WEEKS).mul(new BN(2));
			let lockedTS = await getTimeFromKickoff(duration);
			await staking.stake(amount, lockedTS, root, root);

			let newTime = await getTimeFromKickoff(TWO_WEEKS);
			await expectRevert(
				staking.extendStakingDuration(lockedTS, newTime),
				"Staking::extendStakingDuration: cannot reduce the staking duration"
			);
		});

		it("Do not exceed the max duration", async () => {
			let amount = "1000";
			let duration = new BN(TWO_WEEKS).mul(new BN(2));
			let lockedTS = await getTimeFromKickoff(duration);
			await staking.stake(amount, lockedTS, root, root);

			let newTime = await getTimeFromKickoff(MAX_DURATION.mul(new BN(2)));
			let tx = await staking.extendStakingDuration(lockedTS, newTime);

			expectEvent(tx, "ExtendedStakingDuration", {
				staker: root,
				previousDate: lockedTS,
				newDate: await getTimeFromKickoff(MAX_DURATION),
			});
		});

		it("Should be able to extend staking duration", async () => {
			let amount = "1000";
			let lockedTS = await getTimeFromKickoff(TWO_WEEKS);
			let tx1 = await staking.stake(amount, lockedTS, root, root);

			let stackingbBalance = await token.balanceOf.call(staking.address);
			expect(stackingbBalance.toString()).to.be.equal(amount);
			let beforeBalance = await token.balanceOf.call(root);

			expect(tx1.logs[2].args.lockedUntil.toNumber()).to.be.equal(lockedTS.toNumber());

			let newLockedTS = await getTimeFromKickoff(TWO_WEEKS * 2);
			let tx2 = await staking.extendStakingDuration(lockedTS, newLockedTS);

			stackingbBalance = await token.balanceOf.call(staking.address);
			expect(stackingbBalance.toString()).to.be.equal(amount);
			let afterBalance = await token.balanceOf.call(root);
			expect(beforeBalance.sub(afterBalance).toNumber()).to.be.equal(0);

			//_decreaseDailyStake
			let numTotalStakingCheckpoints = await staking.numTotalStakingCheckpoints.call(lockedTS);
			expect(numTotalStakingCheckpoints.toNumber()).to.be.equal(2);
			let checkpoint = await staking.totalStakingCheckpoints.call(lockedTS, 0);
			expect(checkpoint.fromBlock.toNumber()).to.be.equal(tx1.receipt.blockNumber);
			expect(checkpoint.stake.toString()).to.be.equal(amount);
			checkpoint = await staking.totalStakingCheckpoints.call(lockedTS, 1);
			expect(checkpoint.fromBlock.toNumber()).to.be.equal(tx2.receipt.blockNumber);
			expect(checkpoint.stake.toString()).to.be.equal("0");

			//_increaseDailyStake
			numTotalStakingCheckpoints = await staking.numTotalStakingCheckpoints.call(newLockedTS);
			expect(numTotalStakingCheckpoints.toNumber()).to.be.equal(1);
			checkpoint = await staking.totalStakingCheckpoints.call(newLockedTS, 0);
			expect(checkpoint.fromBlock.toNumber()).to.be.equal(tx2.receipt.blockNumber);
			expect(checkpoint.stake.toString()).to.be.equal(amount);

			//_writeUserCheckpoint
			let numUserCheckpoints = await staking.numUserStakingCheckpoints.call(root, lockedTS);
			expect(numUserCheckpoints.toNumber()).to.be.equal(2);
			checkpoint = await staking.userStakingCheckpoints.call(root, lockedTS, 0);
			expect(checkpoint.fromBlock.toNumber()).to.be.equal(tx1.receipt.blockNumber);
			expect(checkpoint.stake.toString()).to.be.equal(amount);
			checkpoint = await staking.userStakingCheckpoints.call(root, newLockedTS, 0);
			expect(checkpoint.fromBlock.toNumber()).to.be.equal(tx2.receipt.blockNumber);
			expect(checkpoint.stake.toString()).to.be.equal(amount);

			expectEvent(tx2, "ExtendedStakingDuration", {
				staker: root,
				previousDate: lockedTS,
				newDate: newLockedTS,
			});
		});
	});

	describe("increaseStake", () => {
		it("Amount of tokens to stake needs to be bigger than 0", async () => {
			let amount = "1000";
			let duration = new BN(TWO_WEEKS).mul(new BN(2));
			let lockTS = await getTimeFromKickoff(duration);
			await staking.stake(amount, lockTS, root, root);

			await expectRevert(
				staking.stake("0", lockTS, root, root),
				"Staking::stake: amount of tokens to stake needs to be bigger than 0"
			);
		});

		it("Amount of tokens to stake needs to be bigger than 0", async () => {
			let amount = "1000";
			let duration = new BN(TWO_WEEKS).mul(new BN(2));
			let lockTS = await getTimeFromKickoff(duration);
			await staking.stake(amount, lockTS, root, root);

			await token.approve(staking.address, 0);
			await expectRevert(staking.stake(amount, lockTS, root, root), "ERC20: transfer amount exceeds allowance");
		});

		it("Shouldn't be able to overflow balance", async () => {
			let amount = "1000";
			let duration = new BN(TWO_WEEKS).mul(new BN(2));
			let lockTS = await getTimeFromKickoff(duration);
			await staking.stake(amount, lockTS, root, root);

			let maxValue = new BN(2).pow(new BN(96)).sub(new BN(1));
			await expectRevert(staking.stake(maxValue.sub(new BN(100)), lockTS, root, root), "Staking::increaseStake: balance overflow");
		});

		it("Should be able to increase stake", async () => {
			let amount = "1000";
			let duration = new BN(TWO_WEEKS).mul(new BN(2));
			let lockedTS = await getTimeFromKickoff(duration);
			let tx1 = await staking.stake(amount, lockedTS, root, root);

			//check delegatee
			let delegatee = await staking.delegates(root, lockedTS);
			expect(delegatee).equal(root);

			let stackingbBalance = await token.balanceOf.call(staking.address);
			expect(stackingbBalance.toString()).to.be.equal(amount);
			let beforeBalance = await token.balanceOf.call(root);

			let tx2 = await staking.stake(amount * 2, lockedTS, root, account1);

			//check delegatee
			delegatee = await staking.delegates(root, lockedTS);
			expect(delegatee).equal(account1);

			stackingbBalance = await token.balanceOf.call(staking.address);
			expect(stackingbBalance.toNumber()).to.be.equal(amount * 3);
			let afterBalance = await token.balanceOf.call(root);
			expect(beforeBalance.sub(afterBalance).toNumber()).to.be.equal(amount * 2);

			//_increaseDailyStake
			let numTotalStakingCheckpoints = await staking.numTotalStakingCheckpoints.call(lockedTS);
			expect(numTotalStakingCheckpoints.toNumber()).to.be.equal(2);
			let checkpoint = await staking.totalStakingCheckpoints.call(lockedTS, 0);
			expect(checkpoint.fromBlock.toNumber()).to.be.equal(tx1.receipt.blockNumber);
			expect(checkpoint.stake.toString()).to.be.equal(amount);
			checkpoint = await staking.totalStakingCheckpoints.call(lockedTS, 1);
			expect(checkpoint.fromBlock.toNumber()).to.be.equal(tx2.receipt.blockNumber);
			expect(checkpoint.stake.toNumber()).to.be.equal(amount * 3);

			//_writeUserCheckpoint
			let numUserCheckpoints = await staking.numUserStakingCheckpoints.call(root, lockedTS);
			expect(numUserCheckpoints.toNumber()).to.be.equal(2);
			checkpoint = await staking.userStakingCheckpoints.call(root, lockedTS, 0);
			expect(checkpoint.fromBlock.toNumber()).to.be.equal(tx1.receipt.blockNumber);
			expect(checkpoint.stake.toString()).to.be.equal(amount);
			checkpoint = await staking.userStakingCheckpoints.call(root, lockedTS, 1);
			expect(checkpoint.fromBlock.toNumber()).to.be.equal(tx2.receipt.blockNumber);
			expect(checkpoint.stake.toNumber()).to.be.equal(amount * 3);

			//delegateStakingCheckpoints - root
			let numDelegateStakingCheckpoints = await staking.numDelegateStakingCheckpoints.call(root, lockedTS);
			expect(numDelegateStakingCheckpoints.toNumber()).to.be.equal(2);
			checkpoint = await staking.delegateStakingCheckpoints.call(root, lockedTS, 0);
			expect(checkpoint.fromBlock.toNumber()).to.be.equal(tx1.receipt.blockNumber);
			expect(checkpoint.stake.toString()).to.be.equal(amount);
			checkpoint = await staking.delegateStakingCheckpoints.call(root, lockedTS, 1);
			expect(checkpoint.fromBlock.toNumber()).to.be.equal(tx2.receipt.blockNumber);
			expect(checkpoint.stake.toNumber()).to.be.equal(0);

			//delegateStakingCheckpoints - account1
			numDelegateStakingCheckpoints = await staking.numDelegateStakingCheckpoints.call(account1, lockedTS);
			expect(numDelegateStakingCheckpoints.toNumber()).to.be.equal(1);
			checkpoint = await staking.delegateStakingCheckpoints.call(account1, lockedTS, 0);
			expect(checkpoint.fromBlock.toNumber()).to.be.equal(tx2.receipt.blockNumber);
			expect(checkpoint.stake.toNumber()).to.be.equal(amount * 3);

			expectEvent(tx2, "TokensStaked", {
				staker: root,
				amount: new BN(amount * 2),
				lockedUntil: lockedTS,
				totalStaked: new BN(amount * 3),
			});
		});
	});

	describe("getStakes", () => {
		it("Should be able to increase stake", async () => {
			let amount1 = "1000";
			let lockedTS1 = await getTimeFromKickoff(new BN(TWO_WEEKS));
			await staking.stake(amount1, lockedTS1, root, root);

			//time travel
			await time.increase(TWO_WEEKS * 10);

			let amount2 = "5000";
			let lockedTS2 = await getTimeFromKickoff(new BN(MAX_DURATION));
			await staking.stake(amount2, lockedTS2, root, root);

			let data = await staking.getStakes.call(root);

			// for (let i = 0; i < data.dates.length; i++) {

			// }

			expect(data.dates[0]).to.be.bignumber.equal(new BN(lockedTS1));
			expect(data.stakes[0]).to.be.bignumber.equal(new BN(amount1));

			expect(data.dates[1]).to.be.bignumber.equal(new BN(lockedTS2));
			expect(data.stakes[1]).to.be.bignumber.equal(new BN(amount2));
		});
	});

	describe("setWeightScaling", () => {
		it("Shouldn't be able to weight scaling less than min value", async () => {
			await expectRevert(staking.setWeightScaling(0), "weight scaling doesn't belong to range [1, 9]");
		});

		it("Shouldn't be able to weight scaling more than max value", async () => {
			await expectRevert(staking.setWeightScaling(10), "weight scaling doesn't belong to range [1, 9]");
		});

		it("Only owner should be able to weight scaling", async () => {
			await expectRevert(staking.setWeightScaling(5, { from: account1 }), "unauthorized");
		});

		it("Should be able to weight scaling", async () => {
			await staking.setWeightScaling(7);

			expect(await staking.weightScaling.call()).to.be.bignumber.equal(new BN(7));
		});
	});

	describe("withdraw", () => {
		it("Amount of tokens to be withdrawn needs to be bigger than 0", async () => {
			let amount = "1000";
			let duration = new BN(TWO_WEEKS).mul(new BN(2));
			let lockedTS = await getTimeFromKickoff(duration);
			await staking.stake(amount, lockedTS, root, root);

			await expectRevert(
				staking.withdraw("0", lockedTS, root),
				"Staking::withdraw: amount of tokens to be withdrawn needs to be bigger than 0"
			);
		});

		it("Shouldn't be able to withdraw amount greater than balance", async () => {
			let amount = 1000;
			let duration = new BN(TWO_WEEKS).mul(new BN(2));
			let lockedTS = await getTimeFromKickoff(duration);
			await staking.stake(amount, lockedTS, root, root);

			//await setTime(lockedTS);
			setNextBlockTimestamp(lockedTS.toNumber());
			await expectRevert(staking.withdraw(amount * 2, lockedTS, root), "Staking::withdraw: not enough balance");
		});

		it("Should be able to withdraw", async () => {
			let amount = "1000";
			let duration = new BN(TWO_WEEKS).mul(new BN(2));
			let lockedTS = await getTimeFromKickoff(duration);
			let tx1 = await staking.stake(amount, lockedTS, root, root);

			//await setTime(lockedTS);
			setNextBlockTimestamp(lockedTS.toNumber());
			mineBlock();

			let stackingbBalance = await token.balanceOf.call(staking.address);
			expect(stackingbBalance.toString()).to.be.equal(amount);
			let beforeBalance = await token.balanceOf.call(root);

			let tx2 = await staking.withdraw(amount / 2, lockedTS, root);

			stackingbBalance = await token.balanceOf.call(staking.address);
			expect(stackingbBalance.toNumber()).to.be.equal(amount / 2);
			let afterBalance = await token.balanceOf.call(root);
			expect(afterBalance.sub(beforeBalance).toNumber()).to.be.equal(amount / 2);

			//_increaseDailyStake
			let numTotalStakingCheckpoints = await staking.numTotalStakingCheckpoints.call(lockedTS);
			expect(numTotalStakingCheckpoints.toNumber()).to.be.equal(2);
			let checkpoint = await staking.totalStakingCheckpoints.call(lockedTS, 0);
			expect(checkpoint.fromBlock.toNumber()).to.be.equal(tx1.receipt.blockNumber);
			expect(checkpoint.stake.toString()).to.be.equal(amount);
			checkpoint = await staking.totalStakingCheckpoints.call(lockedTS, 1);
			expect(checkpoint.fromBlock.toNumber()).to.be.equal(tx2.receipt.blockNumber);
			expect(checkpoint.stake.toNumber()).to.be.equal(amount / 2);

			//_writeUserCheckpoint
			let numUserCheckpoints = await staking.numUserStakingCheckpoints.call(root, lockedTS);
			expect(numUserCheckpoints.toNumber()).to.be.equal(2);
			checkpoint = await staking.userStakingCheckpoints.call(root, lockedTS, 0);
			expect(checkpoint.fromBlock.toNumber()).to.be.equal(tx1.receipt.blockNumber);
			expect(checkpoint.stake.toString()).to.be.equal(amount);
			checkpoint = await staking.userStakingCheckpoints.call(root, lockedTS, 1);
			expect(checkpoint.fromBlock.toNumber()).to.be.equal(tx2.receipt.blockNumber);
			expect(checkpoint.stake.toNumber()).to.be.equal(amount / 2);

			//_decreaseDelegateStake
			let numDelegateStakingCheckpoints = await staking.numDelegateStakingCheckpoints.call(root, lockedTS);
			checkpoint = await staking.delegateStakingCheckpoints.call(root, lockedTS, numDelegateStakingCheckpoints - 1);
			expect(checkpoint.fromBlock.toNumber()).to.be.equal(tx2.receipt.blockNumber);
			expect(checkpoint.stake.toNumber()).to.be.equal(amount / 2);
			expect(numDelegateStakingCheckpoints.toNumber()).to.be.equal(2);

			expectEvent(tx2, "TokensWithdrawn", {
				staker: root,
				amount: new BN(amount / 2),
			});
		});

		it("Should be able to withdraw second time", async () => {
			let amount = "1000";
			let duration = new BN(TWO_WEEKS).mul(new BN(2));
			let lockedTS = await getTimeFromKickoff(duration);
			await staking.stake(amount, lockedTS, root, root);

			let stackingbBalance = await token.balanceOf.call(staking.address);
			expect(stackingbBalance.toString()).to.be.equal(amount);

			await staking.withdraw(amount / 2, lockedTS, account2);

			stackingbBalance = await token.balanceOf.call(staking.address);
			expect(stackingbBalance.toNumber()).to.be.equal(amount / 2);

			//_decreaseDelegateStake
			let numDelegateStakingCheckpoints = await staking.numDelegateStakingCheckpoints.call(root, lockedTS);
			let checkpoint = await staking.delegateStakingCheckpoints.call(root, lockedTS, numDelegateStakingCheckpoints - 1);
			expect(checkpoint.stake.toNumber()).to.be.equal(amount / 2);
			expect(numDelegateStakingCheckpoints.toNumber()).to.be.equal(2);

			await staking.withdraw(amount / 2, lockedTS, account2);

			stackingbBalance = await token.balanceOf.call(staking.address);
			expect(stackingbBalance.toNumber()).to.be.equal(0);

			//_decreaseDelegateStake
			numDelegateStakingCheckpoints = await staking.numDelegateStakingCheckpoints.call(root, lockedTS);
			checkpoint = await staking.delegateStakingCheckpoints.call(root, lockedTS, numDelegateStakingCheckpoints - 1);
			expect(checkpoint.stake.toNumber()).to.be.equal(0);
			expect(numDelegateStakingCheckpoints.toNumber()).to.be.equal(3);

			let feeSharingBalance = await token.balanceOf.call(feeSharingProxy.address);
			let userBalance = await token.balanceOf.call(account2);

			let maxVotingWeight = await staking.MAX_VOTING_WEIGHT.call();
			let maxDuration = await staking.MAX_DURATION.call();
			let weightFactor = await staking.WEIGHT_FACTOR.call();
			let weight = weightingFunction(amount, duration, maxDuration, maxVotingWeight, weightFactor.toNumber()) / 100;
			let weightScaling = await staking.weightScaling.call();
			weight = weight * weightScaling;
			let punishedAmount = weight;

			await expect(feeSharingBalance).to.be.bignumber.equal(new BN(punishedAmount));
			await expect(userBalance).to.be.bignumber.equal(new BN(amount - punishedAmount));
		});

		it("Should be able to withdraw second time", async () => {
			let amount = "1000";
			let duration = new BN(TWO_WEEKS).mul(new BN(2));
			let lockedTS = await getTimeFromKickoff(duration);
			await staking.stake(amount, lockedTS, root, root);

			await staking.withdraw(amount, lockedTS, root);

			await staking.stake(amount, lockedTS, root, root);

			await staking.withdraw(amount, lockedTS, root);
		});

		it("Should be able to withdraw second time after partial withdraw", async () => {
			let amount = new BN(1000);
			let duration = new BN(TWO_WEEKS).mul(new BN(2));
			let lockedTS = await getTimeFromKickoff(duration);
			await staking.stake(amount, lockedTS, root, root);

			await staking.withdraw(amount.sub(new BN(1)), lockedTS, root);

			await staking.stake(amount, lockedTS, root, root);

			await staking.withdraw(amount.add(new BN(1)), lockedTS, root);
		});

		it("Should be able to withdraw second time (emulate issue with delegate checkpoint)", async () => {
			let amount = "1000";
			let duration = new BN(TWO_WEEKS).mul(new BN(2));
			let lockedTS = await getTimeFromKickoff(duration);
			await staking.stake(amount, lockedTS, root, root);

			await staking.withdraw(amount, lockedTS, root);

			await staking.stake(amount, lockedTS, root, root);
			await staking.setDelegateStake(root, lockedTS, 0);

			await staking.withdraw(amount, lockedTS, root);
		});

		it("Should be able to extend stake after second stake (emulate issue with delegate checkpoint)", async () => {
			let amount = "1000";
			let duration = new BN(TWO_WEEKS).mul(new BN(2));
			let lockedTS = await getTimeFromKickoff(duration);
			await staking.stake(amount, lockedTS, root, root);

			await staking.withdraw(amount, lockedTS, root);

			await staking.stake(amount, lockedTS, root, root);
			await staking.setDelegateStake(root, lockedTS, 0);

			let lockedTS2 = await getTimeFromKickoff(duration.mul(new BN(3)));
			await staking.extendStakingDuration(lockedTS, lockedTS2);
		});

		it("Should be able to delegate stake after second stake (emulate issue with delegate checkpoint)", async () => {
			let amount = "1000";
			let duration = new BN(TWO_WEEKS).mul(new BN(2));
			let lockedTS = await getTimeFromKickoff(duration);
			await staking.stake(amount, lockedTS, root, root);

			await staking.withdraw(amount, lockedTS, root);

			await staking.stake(amount, lockedTS, root, root);
			await staking.setDelegateStake(root, lockedTS, 0);

			await staking.delegate(account1, lockedTS);
		});

		it("Should be able to withdraw earlier for any lock date", async () => {
			let amount = "10000";

			for (let i = 1; i <= 78; i++) {
				if (i !== 1 && i !== 78 && i % 10 !== 0) {
					continue;
				}

				feeSharingProxy = await FeeSharingProxy.new(protocol.address, staking.address);
				await staking.setFeeSharing(feeSharingProxy.address);

				let duration = new BN(i * TWO_WEEKS);
				let lockedTS = await getTimeFromKickoff(duration);
				await staking.stake(amount, lockedTS, root, root);

				let stackingbBalance = await token.balanceOf.call(staking.address);
				expect(stackingbBalance.toString()).to.be.equal(amount);

				await mineBlock();
				let amounts = await staking.getWithdrawAmounts(amount, lockedTS);
				let returnedAvailableAmount = amounts[0];
				let returnedPunishedAmount = amounts[1];

				await staking.withdraw(amount, lockedTS, account2);

				stackingbBalance = await token.balanceOf.call(staking.address);
				expect(stackingbBalance.toNumber()).to.be.equal(0);

				let feeSharingBalance = await token.balanceOf.call(feeSharingProxy.address);
				let userBalance = await token.balanceOf.call(account2);

				let maxVotingWeight = await staking.MAX_VOTING_WEIGHT.call();
				let maxDuration = await staking.MAX_DURATION.call();
				let weightFactor = await staking.WEIGHT_FACTOR.call();
				let weight = weightingFunction(amount, duration, maxDuration, maxVotingWeight, weightFactor.toNumber()) / 100;
				let weightScaling = await staking.weightScaling.call();
				weight = weight * weightScaling;
				let punishedAmount = weight;

				let weeks = i * 2;

				expect(feeSharingBalance).to.be.bignumber.equal(new BN(punishedAmount));

				expect(returnedPunishedAmount).to.be.bignumber.equal(new BN(punishedAmount));
				expect(returnedAvailableAmount).to.be.bignumber.equal(new BN(amount).sub(returnedPunishedAmount));
			}
		});
	});

	describe("unlockAllTokens", () => {
		it("Only owner should be able to unlock all tokens", async () => {
			await expectRevert(staking.unlockAllTokens({ from: account1 }), "unauthorized");
		});

		it("Should be able to unlock all tokens", async () => {
			let amount = "1000";
			let duration = new BN(TWO_WEEKS).mul(new BN(2));
			let lockedTS = await getTimeFromKickoff(duration);
			await staking.stake(amount, lockedTS, root, root);

			let tx = await staking.unlockAllTokens();

			expectEvent(tx, "TokensUnlocked", {
				amount: amount,
			});

			await staking.withdraw(amount, lockedTS, root);
		});
	});

	describe("timestampToLockDate", () => {
		before(async () => {
			[root, account1, account2, account3, ...accounts] = accounts;

			token = await TestToken.new(name, symbol, 18, TOTAL_SUPPLY);

			let stakingLogic = await StakingLogic.new(token.address);
			staking = await StakingProxy.new(token.address);
			await staking.setImplementation(stakingLogic.address);
			staking = await StakingLogic.at(staking.address);
		});

		it("Lock date should be start + 1 period", async () => {
			let kickoffTS = await staking.kickoffTS.call();
			let newTime = kickoffTS.add(new BN(TWO_WEEKS));
			//await setTime(newTime);
			setNextBlockTimestamp(newTime.toNumber());

			let result = await staking.timestampToLockDate(newTime);
			expect(result.sub(kickoffTS).toNumber()).to.be.equal(TWO_WEEKS);
		});

		it("Lock date should be start + 2 period", async () => {
			let kickoffTS = await staking.kickoffTS.call();
			let newTime = kickoffTS.add(new BN(TWO_WEEKS).mul(new BN(2)).add(new BN(DAY)));
			//await setTime(newTime);
			setNextBlockTimestamp(newTime.toNumber());

			let result = await staking.timestampToLockDate(newTime);
			expect(result.sub(kickoffTS).toNumber()).to.be.equal(TWO_WEEKS * 2);
		});

		it("Lock date should be start + 3 period", async () => {
			let kickoffTS = await staking.kickoffTS.call();
			let newTime = kickoffTS.add(new BN(TWO_WEEKS).mul(new BN(3)).add(new BN(DAY)));
			//await setTime(newTime);
			setNextBlockTimestamp(newTime.toNumber());

			let result = await staking.timestampToLockDate(newTime);
			expect(result.sub(kickoffTS).toNumber()).to.be.equal(TWO_WEEKS * 3);
		});
	});

	describe("upgrade:", async () => {
		it("Should be able to read correct data after an upgrade", async () => {
			let amount = 100;
			let lockedTS = await getTimeFromKickoff(MAX_DURATION);
			let tx = await staking.stake(amount, lockedTS, root, root);

			//before upgrade
			let balance = await staking.balanceOf.call(root);
			expect(balance.toNumber()).to.be.equal(amount);
			let checkpoint = await staking.userStakingCheckpoints.call(root, lockedTS, 0);
			expect(checkpoint.fromBlock.toNumber()).to.be.equal(tx.receipt.blockNumber);
			expect(checkpoint.stake.toNumber()).to.be.equal(amount);

			//upgrade
			staking = await StakingProxy.at(staking.address);
			let stakingMockup = await StakingMockup.new(token.address);
			await staking.setImplementation(stakingMockup.address);
			staking = await StakingMockup.at(staking.address);

			//after upgrade: storage data remained the same
			balance = await staking.balanceOf.call(root);
			expect(balance.toNumber()).to.be.equal(amount);
			checkpoint = await staking.userStakingCheckpoints.call(root, lockedTS, 0);
			expect(checkpoint.fromBlock.toNumber()).to.be.equal(tx.receipt.blockNumber);
			expect(checkpoint.stake.toNumber()).to.be.equal(amount);

			//after upgrade: new method added
			balance = await staking.balanceOf_MultipliedByTwo.call(root);
			expect(balance.toNumber()).to.be.equal(amount * 2);
		});
	});

	async function getTimeFromKickoff(delay) {
		let kickoffTS = await staking.kickoffTS.call();
		return kickoffTS.add(new BN(delay));
	}
});

function weightingFunction(stake, time, maxDuration, maxVotingWeight, weightFactor) {
	let x = maxDuration - time;
	let mD2 = maxDuration * maxDuration;
	return Math.floor((stake * (Math.floor((maxVotingWeight * weightFactor * (mD2 - x * x)) / mD2) + weightFactor)) / weightFactor);
}
