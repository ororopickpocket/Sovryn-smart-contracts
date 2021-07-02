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
	lastBlock,
} = require("../Utils/Ethereum");

const StakingLogic = artifacts.require("Staking");
const StakingProxy = artifacts.require("StakingProxy");
const SOV = artifacts.require("SOV");
const FeeSharingProxy = artifacts.require("FeeSharingProxyMockup");
const VestingLogic = artifacts.require("VestingLogicMockup");
const Vesting = artifacts.require("TeamVesting");

const MAX_DURATION = new BN(24 * 60 * 60).mul(new BN(1092));
const WEEK = new BN(7 * 24 * 60 * 60);

const TOTAL_SUPPLY = "10000000000000000000000000";
const ONE_MILLON = "1000000000000000000000000";

contract("Vesting", (accounts) => {
	const name = "Test token";
	const symbol = "TST";

	let root, a1, a2, a3;
	let token, staking, stakingLogic, feeSharingProxy;
	let vestingLogic;
	let kickoffTS;

	let cliff = "10";
	let duration = "100";

	before(async () => {
		[root, a1, a2, a3, ...accounts] = accounts;
		token = await SOV.new(TOTAL_SUPPLY);

		vestingLogic = await VestingLogic.new();

		feeSharingProxy = await FeeSharingProxy.new(constants.ZERO_ADDRESS, constants.ZERO_ADDRESS);

		stakingLogic = await StakingLogic.new(token.address);
		staking = await StakingProxy.new(token.address);
		await staking.setImplementation(stakingLogic.address);
		staking = await StakingLogic.at(staking.address);

		await token.transfer(a2, "1000");
		await token.approve(staking.address, "1000", { from: a2 });

		kickoffTS = await staking.kickoffTS.call();
	});

	describe("constructor", () => {
		it("sets the expected values", async () => {
			let vestingInstance = await Vesting.new(
				vestingLogic.address,
				token.address,
				staking.address,
				root,
				cliff,
				duration,
				feeSharingProxy.address
			);
			vestingInstance = await VestingLogic.at(vestingInstance.address);

			//Check data
			let _sov = await vestingInstance.SOV();
			let _stackingAddress = await vestingInstance.staking();
			let _tokenOwner = await vestingInstance.tokenOwner();
			let _cliff = await vestingInstance.cliff();
			let _duration = await vestingInstance.duration();
			let _feeSharingProxy = await vestingInstance.feeSharingProxy();

			assert.equal(_sov, token.address);
			assert.equal(_stackingAddress, staking.address);
			assert.equal(_tokenOwner, root);
			assert.equal(_cliff.toString(), cliff);
			assert.equal(_duration.toString(), duration);
			assert.equal(_feeSharingProxy, feeSharingProxy.address);
		});

		it("fails if the 0 address is passed as SOV address", async () => {
			await expectRevert(
				Vesting.new(vestingLogic.address, constants.ZERO_ADDRESS, staking.address, root, cliff, duration, feeSharingProxy.address),

				"SOV address invalid"
			);
		});

		it("fails if the 0 address is passed as token owner address", async () => {
			await expectRevert(
				Vesting.new(
					vestingLogic.address,
					token.address,
					staking.address,
					constants.ZERO_ADDRESS,
					cliff,
					duration,
					feeSharingProxy.address
				),
				"token owner address invalid"
			);
		});

		it("fails if the 0 address is passed as staking address", async () => {
			await expectRevert(
				Vesting.new(vestingLogic.address, token.address, constants.ZERO_ADDRESS, root, cliff, duration, feeSharingProxy.address),
				"staking address invalid"
			);
		});

		it("fails if the vesting duration is bigger than the max staking duration", async () => {
			await expectRevert(
				Vesting.new(
					vestingLogic.address,
					token.address,
					staking.address,
					root,
					cliff,
					MAX_DURATION.add(new BN(1)),
					feeSharingProxy.address
				),
				"duration may not exceed the max duration"
			);
		});

		it("fails if the vesting duration is shorter than the cliff", async () => {
			await expectRevert(
				Vesting.new(vestingLogic.address, token.address, staking.address, root, 100, 99, feeSharingProxy.address),
				"duration must be bigger than or equal to the cliff"
			);
		});

		it("fails if the 0 address is passed as feeSharingProxy address", async () => {
			await expectRevert(
				Vesting.new(vestingLogic.address, token.address, staking.address, root, cliff, duration, constants.ZERO_ADDRESS),
				"feeSharingProxy address invalid"
			);
		});
	});

	describe("delegate", () => {
		let vesting;
		it("should stake tokens 2 times and delegate voting power", async () => {
			let toStake = ONE_MILLON;
			vesting = await Vesting.new(
				vestingLogic.address,
				token.address,
				staking.address,
				a2,
				26 * WEEK,
				106 * WEEK,
				feeSharingProxy.address
			);
			vesting = await VestingLogic.at(vesting.address);

			await token.approve(vesting.address, toStake);
			await vesting.stakeTokens(toStake);

			await increaseTime(50 * WEEK);
			await token.approve(vesting.address, toStake);
			await vesting.stakeTokens(toStake);

			//check delegatee
			let data = await staking.getStakes.call(vesting.address);
			for (let i = 0; i < data.dates.length; i++) {
				let delegatee = await staking.delegates(vesting.address, data.dates[i]);
				expect(delegatee).equal(a2);
			}

			await staking.addContractCodeHash(vesting.address);
			//delegate
			let tx = await vesting.delegate(a1, { from: a2 });

			expectEvent(tx, "VotesDelegated", {
				caller: a2,
				delegatee: a1,
			});

			//check new delegatee
			data = await staking.getStakes.call(vesting.address);
			for (let i = 0; i < data.dates.length; i++) {
				let delegatee = await staking.delegates(vesting.address, data.dates[i]);
				expect(delegatee).equal(a1);
			}
		});

		it("should stake tokens 1 time and delegate voting power (using vesting logic with bug in delegation)", async () => {
			let toStake = ONE_MILLON;
			vesting = await Vesting.new(
				vestingLogic.address,
				token.address,
				staking.address,
				a2,
				26 * WEEK,
				106 * WEEK,
				feeSharingProxy.address
			);
			vesting = await VestingLogic.at(vesting.address);

			await token.approve(vesting.address, toStake);
			await vesting.stakeTokens(toStake);

			//check delegatee
			let data = await staking.getStakes.call(vesting.address);
			for (let i = 0; i < data.dates.length; i++) {
				let delegatee = await staking.delegates(vesting.address, data.dates[i]);
				expect(delegatee).equal(a2);
			}

			await staking.addContractCodeHash(vesting.address);
			//delegate
			let tx = await vesting.delegate(a1, { from: a2 });

			expectEvent(tx, "VotesDelegated", {
				caller: a2,
				delegatee: a1,
			});

			//check new delegatee
			data = await staking.getStakes.call(vesting.address);
			for (let i = 0; i < data.dates.length; i++) {
				let delegatee = await staking.delegates(vesting.address, data.dates[i]);
				expect(delegatee).equal(a1);
			}
		});

		it("fails if delegatee is zero address", async () => {
			await expectRevert(vesting.delegate(constants.ZERO_ADDRESS, { from: a2 }), "delegatee address invalid");
		});

		it("fails if not a token owner", async () => {
			await expectRevert(vesting.delegate(a1, { from: a1 }), "unauthorized");
		});
	});

	describe("stakeTokens; using Ganache", () => {
		let vesting;
		it("should stake 1,000,000 SOV with a duration of 104 weeks and a 26 week cliff", async () => {
			vesting = await Vesting.new(
				vestingLogic.address,
				token.address,
				staking.address,
				root,
				26 * WEEK,
				104 * WEEK,
				feeSharingProxy.address
			);
			vesting = await VestingLogic.at(vesting.address);
			await token.approve(vesting.address, ONE_MILLON);
			let tx = await vesting.stakeTokens(ONE_MILLON);

			expectEvent(tx, "TokensStaked", {
				caller: root,
				amount: ONE_MILLON,
			});

			//check delegatee
			let data = await staking.getStakes.call(vesting.address);
			for (let i = 0; i < data.dates.length; i++) {
				let delegatee = await staking.delegates(vesting.address, data.dates[i]);
				expect(delegatee).equal(root);
			}
		});

		it("should stake 1,000,000 SOV with a duration of 104 weeks and a 26 week cliff", async () => {
			//let block = await web3.eth.getBlock("latest");
			let block = await lastBlock(); //ethers.provider.getBlock("latest");
			let timestamp = parseInt(block.timestamp);

			let kickoffTS = await staking.kickoffTS();

			let start = timestamp + 26 * WEEK;
			let end = timestamp + 104 * WEEK;

			let numIntervals = Math.floor((end - start) / (4 * WEEK)) + 1;
			let stakedPerInterval = ONE_MILLON / numIntervals;

			//positive case
			for (let i = start; i <= end; i += 4 * WEEK) {
				let periodFromKickoff = Math.floor((i - kickoffTS.toNumber()) / (2 * WEEK));
				let startBuf = periodFromKickoff * 2 * WEEK + kickoffTS.toNumber();
				let userStakingCheckpoints = await staking.userStakingCheckpoints(vesting.address, startBuf, 0);

				assert.equal(userStakingCheckpoints.fromBlock.toNumber(), block.number);
				assert.equal(userStakingCheckpoints.stake.toString(), stakedPerInterval);

				let numUserStakingCheckpoints = await staking.numUserStakingCheckpoints(vesting.address, startBuf);
				assert.equal(numUserStakingCheckpoints.toString(), "1");
			}

			//negative cases

			//start-10 to avoid coming to active checkpoint
			let periodFromKickoff = Math.floor((start - 10 - kickoffTS.toNumber()) / (2 * WEEK));
			let startBuf = periodFromKickoff * 2 * WEEK + kickoffTS.toNumber();
			let userStakingCheckpoints = await staking.userStakingCheckpoints(vesting.address, startBuf, 0);

			assert.equal(userStakingCheckpoints.fromBlock.toNumber(), 0);
			assert.equal(userStakingCheckpoints.stake.toString(), 0);

			let numUserStakingCheckpoints = await staking.numUserStakingCheckpoints(vesting.address, startBuf);
			assert.equal(numUserStakingCheckpoints.toString(), "0");

			periodFromKickoff = Math.floor((end + 1 - kickoffTS.toNumber()) / (2 * WEEK));
			startBuf = periodFromKickoff * 2 * WEEK + kickoffTS.toNumber();
			userStakingCheckpoints = await staking.userStakingCheckpoints(vesting.address, startBuf, 0);

			assert.equal(userStakingCheckpoints.fromBlock.toNumber(), 0);
			assert.equal(userStakingCheckpoints.stake.toString(), 0);

			numUserStakingCheckpoints = await staking.numUserStakingCheckpoints(vesting.address, startBuf);
			assert.equal(numUserStakingCheckpoints.toString(), "0");
		});

		it("should stake 2 times 1,000,000 SOV with a duration of 104 weeks and a 26 week cliff", async () => {
			let amount = 1000;
			let cliff = 28 * WEEK;
			let duration = 104 * WEEK;
			vesting = await Vesting.new(
				vestingLogic.address,
				token.address,
				staking.address,
				root,
				cliff,
				duration,
				feeSharingProxy.address
			);
			vesting = await VestingLogic.at(vesting.address);

			await token.approve(vesting.address, amount);
			await vesting.stakeTokens(amount);

			let block1 = await web3.eth.getBlock("latest");
			let timestamp1 = block1.timestamp;

			let start = timestamp1 + cliff;
			let end = timestamp1 + duration;

			let numIntervals = Math.floor((end - start) / (4 * WEEK)) + 1;
			let stakedPerInterval = amount / numIntervals;

			await increaseTime(52 * WEEK);
			await token.approve(vesting.address, amount);
			await vesting.stakeTokens(amount);

			let block2 = await web3.eth.getBlock("latest");
			let timestamp2 = block2.timestamp;

			let start2 = await staking.timestampToLockDate(timestamp2 + cliff);
			let end2 = timestamp2 + duration;

			//positive case
			for (let i = start; i <= end2; i += 4 * WEEK) {
				let lockedTS = await staking.timestampToLockDate(i);
				let numUserStakingCheckpoints = await staking.numUserStakingCheckpoints(vesting.address, lockedTS);
				let userStakingCheckpoints = await staking.userStakingCheckpoints(vesting.address, lockedTS, numUserStakingCheckpoints - 1);
				if (i < start2 || i > end) {
					assert.equal(numUserStakingCheckpoints.toString(), "1");
					assert.equal(userStakingCheckpoints.stake.toString(), stakedPerInterval);
				} else {
					assert.equal(numUserStakingCheckpoints.toString(), "2");
					assert.equal(userStakingCheckpoints.stake.toString(), stakedPerInterval * 2);
				}
			}
		});

		it("should stake 1000 tokens with a duration of 34 weeks and a 26 week cliff (dust on rounding)", async () => {
			let amount = 1000;
			let cliff = 26 * WEEK;
			let duration = 34 * WEEK;
			vesting = await Vesting.new(
				vestingLogic.address,
				token.address,
				staking.address,
				root,
				cliff,
				duration,
				feeSharingProxy.address
			);
			vesting = await VestingLogic.at(vesting.address);

			await token.approve(vesting.address, amount);
			await vesting.stakeTokens(amount);

			let block = await web3.eth.getBlock("latest");
			let timestamp = block.timestamp;

			let start = timestamp + cliff;
			let end = timestamp + duration;

			let numIntervals = Math.floor((end - start) / (4 * WEEK)) + 1;
			let stakedPerInterval = Math.floor(amount / numIntervals);

			let stakeForFirstInterval = amount - stakedPerInterval * (numIntervals - 1);

			//positive case
			for (let i = start; i <= end; i += 4 * WEEK) {
				let periodFromKickoff = Math.floor((i - kickoffTS.toNumber()) / (2 * WEEK));
				let startBuf = periodFromKickoff * 2 * WEEK + kickoffTS.toNumber();
				let userStakingCheckpoints = await staking.userStakingCheckpoints(vesting.address, startBuf, 0);

				assert.equal(userStakingCheckpoints.fromBlock.toNumber(), block.number);
				if (i === start) {
					assert.equal(userStakingCheckpoints.stake.toString(), stakeForFirstInterval);
				} else {
					assert.equal(userStakingCheckpoints.stake.toString(), stakedPerInterval);
				}

				let numUserStakingCheckpoints = await staking.numUserStakingCheckpoints(vesting.address, startBuf);
				assert.equal(numUserStakingCheckpoints.toString(), "1");
			}
		});
	});

	describe("stakeTokensWithApproval", () => {
		let vesting;

		it("fails if invoked directly", async () => {
			let amount = 1000;
			let cliff = 26 * WEEK;
			let duration = 34 * WEEK;
			vesting = await Vesting.new(
				vestingLogic.address,
				token.address,
				staking.address,
				root,
				cliff,
				duration,
				feeSharingProxy.address
			);
			vesting = await VestingLogic.at(vesting.address);
			await expectRevert(vesting.stakeTokensWithApproval(root, amount), "unauthorized");
		});

		it("fails if pass wrong method in data", async () => {
			let amount = 1000;
			let cliff = 26 * WEEK;
			let duration = 34 * WEEK;
			vesting = await Vesting.new(
				vestingLogic.address,
				token.address,
				staking.address,
				root,
				cliff,
				duration,
				feeSharingProxy.address
			);
			vesting = await VestingLogic.at(vesting.address);

			let contract = new web3.eth.Contract(vesting.abi, vesting.address);
			let sender = root;
			let data = contract.methods.stakeTokens(amount).encodeABI();

			await expectRevert(token.approveAndCall(vesting.address, amount, data, { from: sender }), "method is not allowed");
		});

		it("should stake 1000 tokens with a duration of 34 weeks and a 26 week cliff (dust on rounding)", async () => {
			let amount = 1000;
			let cliff = 26 * WEEK;
			let duration = 34 * WEEK;
			vesting = await Vesting.new(
				vestingLogic.address,
				token.address,
				staking.address,
				root,
				cliff,
				duration,
				feeSharingProxy.address
			);
			vesting = await VestingLogic.at(vesting.address);

			let contract = new web3.eth.Contract(vesting.abi, vesting.address);
			let sender = root;
			let data = contract.methods.stakeTokensWithApproval(sender, amount).encodeABI();
			await token.approveAndCall(vesting.address, amount, data, { from: sender });

			let block = await web3.eth.getBlock("latest");
			let timestamp = block.timestamp;

			let start = timestamp + cliff;
			let end = timestamp + duration;

			let numIntervals = Math.floor((end - start) / (4 * WEEK)) + 1;
			let stakedPerInterval = Math.floor(amount / numIntervals);

			let stakeForFirstInterval = amount - stakedPerInterval * (numIntervals - 1);

			//positive case
			for (let i = start; i <= end; i += 4 * WEEK) {
				let periodFromKickoff = Math.floor((i - kickoffTS.toNumber()) / (2 * WEEK));
				let startBuf = periodFromKickoff * 2 * WEEK + kickoffTS.toNumber();
				let userStakingCheckpoints = await staking.userStakingCheckpoints(vesting.address, startBuf, 0);

				assert.equal(userStakingCheckpoints.fromBlock.toNumber(), block.number);
				if (i === start) {
					assert.equal(userStakingCheckpoints.stake.toString(), stakeForFirstInterval);
				} else {
					assert.equal(userStakingCheckpoints.stake.toString(), stakedPerInterval);
				}

				let numUserStakingCheckpoints = await staking.numUserStakingCheckpoints(vesting.address, startBuf);
				assert.equal(numUserStakingCheckpoints.toString(), "1");
			}
		});
	});

	describe("withdrawTokens", () => {
		let vesting;

		it("should withdraw unlocked tokens (cliff = 3 weeks)", async () => {
			//Save current amount
			let previousAmount = await token.balanceOf(root);
			let toStake = ONE_MILLON;

			await increaseTime(3 * WEEK);

			//Stake
			vesting = await Vesting.new(
				vestingLogic.address,
				token.address,
				staking.address,
				root,
				3 * WEEK,
				3 * WEEK,
				feeSharingProxy.address
			);
			vesting = await VestingLogic.at(vesting.address);

			await token.approve(vesting.address, toStake);
			await vesting.stakeTokens(toStake);

			let amountAfterStake = await token.balanceOf(root);

			//time travel
			await increaseTime(3 * WEEK);

			//withdraw
			let tx = await vesting.withdrawTokens(root);

			//check event
			expectEvent(tx, "TokensWithdrawn", {
				caller: root,
				receiver: root,
			});

			//verify amount
			let amount = await token.balanceOf(root);

			assert.equal(previousAmount.sub(new BN(toStake)).toString(), amountAfterStake.toString());
			assert.equal(previousAmount.toString(), amount.toString());
		});

		it("should withdraw unlocked tokens", async () => {
			//Save current amount
			let previousAmount = await token.balanceOf(root);
			let toStake = ONE_MILLON;

			//Stake
			vesting = await Vesting.new(
				vestingLogic.address,
				token.address,
				staking.address,
				root,
				26 * WEEK,
				104 * WEEK,
				feeSharingProxy.address
			);
			vesting = await VestingLogic.at(vesting.address);

			await token.approve(vesting.address, toStake);
			await vesting.stakeTokens(toStake);

			let amountAfterStake = await token.balanceOf(root);

			//time travel
			await increaseTime(104 * WEEK);

			//withdraw
			let tx = await vesting.withdrawTokens(root);

			//check event
			expectEvent(tx, "TokensWithdrawn", {
				caller: root,
				receiver: root,
			});

			//verify amount
			let amount = await token.balanceOf(root);

			assert.equal(previousAmount.sub(new BN(toStake)).toString(), amountAfterStake.toString());
			assert.equal(previousAmount.toString(), amount.toString());
		});

		it("should withdraw unlocked tokens for 2 stakes", async () => {
			//Save current amount
			let previousAmount = await token.balanceOf(root);
			let toStake = ONE_MILLON;

			//Stake
			vesting = await Vesting.new(
				vestingLogic.address,
				token.address,
				staking.address,
				root,
				26 * WEEK,
				104 * WEEK,
				feeSharingProxy.address
			);
			vesting = await VestingLogic.at(vesting.address);

			await token.approve(vesting.address, toStake);
			await vesting.stakeTokens(toStake);

			await increaseTime(50 * WEEK);
			await token.approve(vesting.address, toStake);
			await vesting.stakeTokens(toStake);

			let amountAfterStake = await token.balanceOf(root);

			//time travel
			await increaseTime(104 * WEEK);

			await staking.addContractCodeHash(vesting.address);
			//withdraw
			let tx = await vesting.withdrawTokens(root);

			//check event
			expectEvent(tx, "TokensWithdrawn", {
				caller: root,
				receiver: root,
			});

			//verify amount
			let amount = await token.balanceOf(root);

			assert.equal(previousAmount.sub(new BN(toStake).mul(new BN(2))).toString(), amountAfterStake.toString());
			assert.equal(previousAmount.toString(), amount.toString());
		});

		it("should withdraw unlocked tokens for 2 stakes (current time >= last locking date of the second stake)", async () => {
			//Save current amount
			let previousAmount = await token.balanceOf(root);
			let toStake = ONE_MILLON;

			//Stake
			vesting = await Vesting.new(
				vestingLogic.address,
				token.address,
				staking.address,
				root,
				4 * WEEK,
				20 * WEEK,
				feeSharingProxy.address
			);
			vesting = await VestingLogic.at(vesting.address);

			await token.approve(vesting.address, toStake);
			await vesting.stakeTokens(toStake);

			await increaseTime(2 * WEEK);
			await token.approve(vesting.address, toStake);
			await vesting.stakeTokens(toStake);

			let amountAfterStake = await token.balanceOf(root);

			//time travel
			await increaseTime(20 * WEEK);

			//withdraw
			let tx = await vesting.withdrawTokens(root);

			//check event
			expectEvent(tx, "TokensWithdrawn", {
				caller: root,
				receiver: root,
			});

			//verify amount
			let amount = await token.balanceOf(root);

			assert.equal(previousAmount.sub(new BN(toStake).mul(new BN(2))).toString(), amountAfterStake.toString());
			assert.equal(previousAmount.toString(), amount.toString());
		});

		it("should withdraw unlocked tokens for 2 stakes (shouldn't withdraw the latest stake)", async () => {
			//Save current amount
			let previousAmount = await token.balanceOf(root);
			let toStake = ONE_MILLON;

			//Stake
			vesting = await Vesting.new(
				vestingLogic.address,
				token.address,
				staking.address,
				root,
				4 * WEEK,
				20 * WEEK,
				feeSharingProxy.address
			);
			vesting = await VestingLogic.at(vesting.address);

			await token.approve(vesting.address, toStake);
			await vesting.stakeTokens(toStake);

			await increaseTime(2 * WEEK);
			await token.approve(vesting.address, toStake);
			await vesting.stakeTokens(toStake);

			let amountAfterStake = await token.balanceOf(root);

			//time travel
			await increaseTime(18 * WEEK);

			//withdraw
			await vesting.withdrawTokens(root);

			let stakes = await staking.getStakes(vesting.address);
			expect(stakes.dates.length).equal(1);
		});

		it("should do nothing if withdrawing a second time", async () => {
			// This part should be tested on staking contract, function getPriorUserStakeByDate
			let previousAmount = await token.balanceOf(root);
			await vesting.withdrawTokens(root);
			let amount = await token.balanceOf(root);

			assert.equal(previousAmount.toString(), amount.toString());
		});

		it("should do nothing if withdrawing before reaching the cliff", async () => {
			let toStake = ONE_MILLON;

			vesting = await Vesting.new(
				vestingLogic.address,
				token.address,
				staking.address,
				a1,
				26 * WEEK,
				104 * WEEK,
				feeSharingProxy.address
			);
			vesting = await VestingLogic.at(vesting.address);

			let previousAmount = await token.balanceOf(root);

			await token.approve(vesting.address, toStake);
			await vesting.stakeTokens(toStake);

			let amountAfterStake = await token.balanceOf(root);

			//time travel
			await increaseTime(25 * WEEK);

			await vesting.withdrawTokens(root, { from: a1 });
			let amount = await token.balanceOf(root);

			assert.equal(previousAmount.sub(new BN(toStake)).toString(), amountAfterStake.toString());
			assert.equal(amountAfterStake.toString(), amount.toString());
		});

		it("should fail if the caller is neither owner nor token owner", async () => {
			await expectRevert(vesting.withdrawTokens(root, { from: a2 }), "unauthorized");
			await expectRevert(vesting.withdrawTokens(root, { from: a3 }), "unauthorized");

			await vesting.withdrawTokens(root, { from: root });
			await vesting.withdrawTokens(root, { from: a1 });
		});

		it("Shouldn't be possible to use governanceWithdrawVesting by not owner", async () => {
			let toStake = ONE_MILLON;

			//Stake
			vesting = await Vesting.new(
				vestingLogic.address,
				token.address,
				staking.address,
				root,
				26 * WEEK,
				104 * WEEK,
				feeSharingProxy.address
			);
			vesting = await VestingLogic.at(vesting.address);

			await token.approve(vesting.address, toStake);
			await vesting.stakeTokens(toStake);

			await expectRevert(staking.governanceWithdrawVesting(vesting.address, root, { from: a1 }), "unauthorized");
		});

		it("Shouldn't be possible to use governanceWithdraw by user", async () => {
			let toStake = ONE_MILLON;

			//Stake
			vesting = await Vesting.new(
				vestingLogic.address,
				token.address,
				staking.address,
				root,
				26 * WEEK,
				104 * WEEK,
				feeSharingProxy.address
			);
			vesting = await VestingLogic.at(vesting.address);

			await token.approve(vesting.address, toStake);
			await vesting.stakeTokens(toStake);

			await expectRevert(staking.governanceWithdraw(100, kickoffTS.toNumber() + 52 * WEEK, root), "unauthorized");
		});

		it("Shouldn't be possible to use governanceWithdrawTokens by user", async () => {
			let toStake = ONE_MILLON;

			//Stake
			vesting = await Vesting.new(
				vestingLogic.address,
				token.address,
				staking.address,
				root,
				26 * WEEK,
				104 * WEEK,
				feeSharingProxy.address
			);
			vesting = await VestingLogic.at(vesting.address);

			await token.approve(vesting.address, toStake);
			await vesting.stakeTokens(toStake);

			await expectRevert(vesting.governanceWithdrawTokens(root), "unauthorized");
		});

		it("governanceWithdrawTokens", async () => {
			let previousAmount = await token.balanceOf(root);
			let toStake = ONE_MILLON;

			//Stake
			vesting = await Vesting.new(
				vestingLogic.address,
				token.address,
				staking.address,
				root,
				26 * WEEK,
				106 * WEEK,
				feeSharingProxy.address
			);
			vesting = await VestingLogic.at(vesting.address);

			await token.approve(vesting.address, toStake);
			await vesting.stakeTokens(toStake);

			await increaseTime(50 * WEEK);
			await token.approve(vesting.address, toStake);
			await vesting.stakeTokens(toStake);

			let amountAfterStake = await token.balanceOf(root);

			await staking.addAdmin(a1);
			//governance withdraw until duration must withdraw all staked tokens without fees
			let tx = await staking.governanceWithdrawVesting(vesting.address, root, { from: a1 });

			expectEvent(tx, "VestingTokensWithdrawn", {
				vesting: vesting.address,
				receiver: root,
			});

			//verify amount
			let amount = await token.balanceOf(root);

			assert.equal(previousAmount.sub(new BN(toStake).mul(new BN(2))).toString(), amountAfterStake.toString());
			assert.equal(previousAmount.toString(), amount.toString());

			let vestingBalance = await staking.balanceOf(vesting.address);
			expect(vestingBalance).to.be.bignumber.equal(new BN(0));
		});
	});

	describe("collectDividends", async () => {
		it("should fail if the caller is neither owner nor token owner", async () => {
			let vesting = await Vesting.new(
				vestingLogic.address,
				token.address,
				staking.address,
				a1,
				26 * WEEK,
				104 * WEEK,
				feeSharingProxy.address
			);
			vesting = await VestingLogic.at(vesting.address);
			await expectRevert(vesting.collectDividends(root, 10, a1, { from: a2 }), "unauthorized");
			await expectRevert(vesting.collectDividends(root, 10, a1, { from: a3 }), "unauthorized");
		});

		it("should collect dividends", async () => {
			let vesting = await Vesting.new(
				vestingLogic.address,
				token.address,
				staking.address,
				a1,
				26 * WEEK,
				104 * WEEK,
				feeSharingProxy.address
			);
			vesting = await VestingLogic.at(vesting.address);

			let maxCheckpoints = new BN(10);
			let tx = await vesting.collectDividends(a1, maxCheckpoints, a2);

			let testData = await feeSharingProxy.testData.call();
			expect(testData.loanPoolToken).to.be.equal(a1);
			expect(testData.maxCheckpoints).to.be.bignumber.equal(maxCheckpoints);
			expect(testData.receiver).to.be.equal(a2);

			expectEvent(tx, "DividendsCollected", {
				caller: root,
				loanPoolToken: a1,
				receiver: a2,
				maxCheckpoints: maxCheckpoints,
			});
		});
	});

	describe("migrateToNewStakingContract", async () => {
		let vesting;
		it("should set the new staking contract", async () => {
			vesting = await Vesting.new(
				vestingLogic.address,
				token.address,
				staking.address,
				a1,
				26 * WEEK,
				104 * WEEK,
				feeSharingProxy.address
			);
			vesting = await VestingLogic.at(vesting.address);
			//1. set new staking contract address on staking contract

			let newStaking = await StakingProxy.new(token.address);
			await newStaking.setImplementation(stakingLogic.address);
			newStaking = await StakingLogic.at(newStaking.address);

			await staking.setNewStakingContract(newStaking.address);

			//2. call migrateToNewStakingContract
			let tx = await vesting.migrateToNewStakingContract();
			expectEvent(tx, "MigratedToNewStakingContract", {
				caller: root,
				newStakingContract: newStaking.address,
			});
			let _staking = await vesting.staking();
			assert.equal(_staking, newStaking.address);
		});

		it("should fail if there is no new staking contract set", async () => {
			let newStaking = await StakingProxy.new(token.address);
			await newStaking.setImplementation(stakingLogic.address);
			newStaking = await StakingLogic.at(newStaking.address);

			vesting = await Vesting.new(
				vestingLogic.address,
				token.address,
				newStaking.address,
				a1,
				26 * WEEK,
				104 * WEEK,
				feeSharingProxy.address
			);
			vesting = await VestingLogic.at(vesting.address);
			await expectRevert(vesting.migrateToNewStakingContract(), "there is no new staking contract set");
		});

		it("should fail if the caller is neither owner nor token owner", async () => {
			let newStaking = await StakingProxy.new(token.address);
			await newStaking.setImplementation(stakingLogic.address);
			newStaking = await StakingLogic.at(newStaking.address);

			vesting = await Vesting.new(
				vestingLogic.address,
				token.address,
				newStaking.address,
				a1,
				26 * WEEK,
				104 * WEEK,
				feeSharingProxy.address
			);
			vesting = await VestingLogic.at(vesting.address);

			await newStaking.setNewStakingContract(newStaking.address);

			await expectRevert(vesting.migrateToNewStakingContract({ from: a2 }), "unauthorized");
			await expectRevert(vesting.migrateToNewStakingContract({ from: a3 }), "unauthorized");

			await vesting.migrateToNewStakingContract();
			await vesting.migrateToNewStakingContract({ from: a1 });
		});
	});
});
