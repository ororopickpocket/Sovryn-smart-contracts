const { expect } = require("chai");
const { expectRevert, expectEvent, constants, BN } = require("@openzeppelin/test-helpers");

const { mineBlock } = require("../Utils/Ethereum");

const StakingLogic = artifacts.require("Staking");
const StakingProxy = artifacts.require("StakingProxy");
const SOV_ABI = artifacts.require("SOV");
const FeeSharingProxy = artifacts.require("FeeSharingProxyMockup");
const VestingLogic = artifacts.require("VestingLogic");
const VestingFactory = artifacts.require("VestingFactory");
const VestingRegistryLogic = artifacts.require("VestingRegistryLogic");
const VestingRegistryProxy = artifacts.require("VestingRegistryProxy");
const UpgradableProxy = artifacts.require("UpgradableProxy");
const LockedSOV = artifacts.require("LockedSOV");
const VestingRegistry = artifacts.require("VestingRegistry");
const VestingRegistry2 = artifacts.require("VestingRegistry2");
const VestingRegistry3 = artifacts.require("VestingRegistry3");
const TestToken = artifacts.require("TestToken");

const FOUR_WEEKS = new BN(4 * 7 * 24 * 60 * 60);
const TEAM_VESTING_CLIFF = FOUR_WEEKS.mul(new BN(6));
const TEAM_VESTING_DURATION = FOUR_WEEKS.mul(new BN(36));
const TOTAL_SUPPLY = "100000000000000000000000000";
const ZERO_ADDRESS = constants.ZERO_ADDRESS;
const pricsSats = "2500";

contract("VestingRegistryLogic", (accounts) => {
	let root, account1, account2, account3, account4;
	let SOV, lockedSOV;
	let staking, stakingLogic, feeSharingProxy;
	let vesting, vestingFactory, vestingLogic, vestingRegistryLogic;
	let vestingRegistry, vestingRegistry2, vestingRegistry3;

	let cliff = 1; // This is in 4 weeks. i.e. 1 * 4 weeks.
	let duration = 11; // This is in 4 weeks. i.e. 11 * 4 weeks.

	before(async () => {
		[root, account1, account2, account3, accounts4, ...accounts] = accounts;
	});

	beforeEach(async () => {
		SOV = await SOV_ABI.new(TOTAL_SUPPLY);
		cSOV1 = await TestToken.new("cSOV1", "cSOV1", 18, TOTAL_SUPPLY);
		cSOV2 = await TestToken.new("cSOV2", "cSOV2", 18, TOTAL_SUPPLY);

		stakingLogic = await StakingLogic.new();
		staking = await StakingProxy.new(SOV.address);
		await staking.setImplementation(stakingLogic.address);
		staking = await StakingLogic.at(staking.address);

		feeSharingProxy = await FeeSharingProxy.new(ZERO_ADDRESS, staking.address);

		vestingLogic = await VestingLogic.new();
		vestingFactory = await VestingFactory.new(vestingLogic.address);

		vestingRegistryLogic = await VestingRegistryLogic.new();
		vesting = await VestingRegistryProxy.new();
		await vesting.setImplementation(vestingRegistryLogic.address);
		vesting = await VestingRegistryLogic.at(vesting.address);
		vestingFactory.transferOwnership(vesting.address);

		lockedSOV = await LockedSOV.new(SOV.address, vesting.address, cliff, duration, [root]);
		await vesting.addAdmin(lockedSOV.address);

		vestingRegistry = await VestingRegistry.new(
			vestingFactory.address,
			SOV.address,
			[cSOV1.address, cSOV2.address],
			pricsSats,
			staking.address,
			feeSharingProxy.address,
			account1
		);

		vestingRegistry2 = await VestingRegistry2.new(
			vestingFactory.address,
			SOV.address,
			[cSOV1.address, cSOV2.address],
			pricsSats,
			staking.address,
			feeSharingProxy.address,
			account1
		);

		vestingRegistry3 = await VestingRegistry3.new(
			vestingFactory.address,
			SOV.address,
			staking.address,
			feeSharingProxy.address,
			account1
		);
	});

	describe("initialize", () => {
		it("fails if the 0 address is passed as vestingFactory address", async () => {
			await expectRevert(
				vesting.initialize(ZERO_ADDRESS, SOV.address, staking.address, feeSharingProxy.address, account1, lockedSOV.address, [
					vestingRegistry.address,
					vestingRegistry2.address,
					vestingRegistry3.address,
				]),
				"vestingFactory address invalid"
			);
		});

		it("fails if the 0 address is passed as SOV address", async () => {
			await expectRevert(
				vesting.initialize(
					vestingFactory.address,
					ZERO_ADDRESS,
					staking.address,
					feeSharingProxy.address,
					account1,
					lockedSOV.address,
					[vestingRegistry.address, vestingRegistry2.address, vestingRegistry3.address]
				),
				"SOV address invalid"
			);
		});

		it("fails if the 0 address is passed as staking address", async () => {
			await expectRevert(
				vesting.initialize(
					vestingFactory.address,
					SOV.address,
					ZERO_ADDRESS,
					feeSharingProxy.address,
					account1,
					lockedSOV.address,
					[vestingRegistry.address, vestingRegistry2.address, vestingRegistry3.address]
				),
				"staking address invalid"
			);
		});

		it("fails if the 0 address is passed as feeSharingProxy address", async () => {
			await expectRevert(
				vesting.initialize(vestingFactory.address, SOV.address, staking.address, ZERO_ADDRESS, account1, lockedSOV.address, [
					vestingRegistry.address,
					vestingRegistry2.address,
					vestingRegistry3.address,
				]),
				"feeSharingProxy address invalid"
			);
		});

		it("fails if the 0 address is passed as vestingOwner address", async () => {
			await expectRevert(
				vesting.initialize(
					vestingFactory.address,
					SOV.address,
					staking.address,
					feeSharingProxy.address,
					ZERO_ADDRESS,
					lockedSOV.address,
					[vestingRegistry.address, vestingRegistry2.address, vestingRegistry3.address]
				),
				"vestingOwner address invalid"
			);
		});

		it("fails if the 0 address is passed as LockedSOV address", async () => {
			await expectRevert(
				vesting.initialize(vestingFactory.address, SOV.address, staking.address, feeSharingProxy.address, account1, ZERO_ADDRESS, [
					vestingRegistry.address,
					vestingRegistry2.address,
					vestingRegistry3.address,
				]),
				"LockedSOV address invalid"
			);
		});

		it("fails if the 0 address is passed as VestingRegistry address", async () => {
			await expectRevert(
				vesting.initialize(
					vestingFactory.address,
					SOV.address,
					staking.address,
					feeSharingProxy.address,
					account1,
					lockedSOV.address,
					[ZERO_ADDRESS, vestingRegistry2.address, vestingRegistry3.address]
				),
				"Vesting registry address invalid"
			);
		});

		it("fails if the 0 address is passed as VestingRegistry2 address", async () => {
			await expectRevert(
				vesting.initialize(
					vestingFactory.address,
					SOV.address,
					staking.address,
					feeSharingProxy.address,
					account1,
					lockedSOV.address,
					[vestingRegistry.address, ZERO_ADDRESS, vestingRegistry3.address]
				),
				"Vesting registry address invalid"
			);
		});

		it("fails if the 0 address is passed as VestingRegistry3 address", async () => {
			await expectRevert(
				vesting.initialize(
					vestingFactory.address,
					SOV.address,
					staking.address,
					feeSharingProxy.address,
					account1,
					lockedSOV.address,
					[vestingRegistry.address, vestingRegistry2.address, ZERO_ADDRESS]
				),
				"Vesting registry address invalid"
			);
		});

		it("sets the expected values", async () => {
			await vesting.initialize(
				vestingFactory.address,
				SOV.address,
				staking.address,
				feeSharingProxy.address,
				account1,
				lockedSOV.address,
				[vestingRegistry.address, vestingRegistry2.address, vestingRegistry3.address]
			);

			let _sov = await vesting.SOV();
			let _staking = await vesting.staking();
			let _feeSharingProxy = await vesting.feeSharingProxy();
			let _vestingOwner = await vesting.vestingOwner();

			expect(_sov).equal(SOV.address);
			expect(_staking).equal(staking.address);
			expect(_feeSharingProxy).equal(feeSharingProxy.address);
			expect(_vestingOwner).equal(account1);
		});

		it("fails if initialize is called twice", async () => {
			await vesting.initialize(
				vestingFactory.address,
				SOV.address,
				staking.address,
				feeSharingProxy.address,
				account1,
				lockedSOV.address,
				[vestingRegistry.address, vestingRegistry2.address, vestingRegistry3.address]
			);
			await expectRevert(
				vesting.initialize(
					vestingFactory.address,
					SOV.address,
					staking.address,
					feeSharingProxy.address,
					account1,
					lockedSOV.address,
					[vestingRegistry.address, vestingRegistry2.address, vestingRegistry3.address]
				),
				"contract is already initialized"
			);
		});
	});

	describe("setVestingFactory", () => {
		it("sets vesting factory", async () => {
			await vesting.setVestingFactory(account2);

			let vestingFactory = await vesting.vestingFactory();
			expect(vestingFactory).equal(account2);
		});

		it("fails if the 0 address is passed", async () => {
			await expectRevert(vesting.setVestingFactory(ZERO_ADDRESS), "vestingFactory address invalid");
		});

		it("fails if sender isn't an owner", async () => {
			await expectRevert(vesting.setVestingFactory(account2, { from: account2 }), "unauthorized");
		});
	});

	describe("addAdmin", () => {
		it("adds admin", async () => {
			let tx = await vesting.addAdmin(account1);

			expectEvent(tx, "AdminAdded", {
				admin: account1,
			});

			let isAdmin = await vesting.admins(account1);
			expect(isAdmin).equal(true);
		});

		it("fails sender isn't an owner", async () => {
			await expectRevert(vesting.addAdmin(account1, { from: account1 }), "unauthorized");
		});
	});

	describe("removeAdmin", () => {
		it("removes admin", async () => {
			await vesting.addAdmin(account1);
			let tx = await vesting.removeAdmin(account1);

			expectEvent(tx, "AdminRemoved", {
				admin: account1,
			});

			let isAdmin = await vesting.admins(account1);
			expect(isAdmin).equal(false);
		});

		it("fails sender isn't an owner", async () => {
			await expectRevert(vesting.removeAdmin(account1, { from: account1 }), "unauthorized");
		});
	});

	describe("transferSOV", () => {
		it("should be able to transfer SOV", async () => {
			await vesting.initialize(
				vestingFactory.address,
				SOV.address,
				staking.address,
				feeSharingProxy.address,
				account1,
				lockedSOV.address,
				[vestingRegistry.address, vestingRegistry2.address, vestingRegistry3.address]
			);

			let amount = new BN(1000);
			await SOV.transfer(vesting.address, amount);
			let balanceBefore = await SOV.balanceOf(account1);
			let tx = await vesting.transferSOV(account1, amount);
			expectEvent(tx, "SOVTransferred", {
				receiver: account1,
				amount: amount,
			});
			let balanceAfter = await SOV.balanceOf(account1);

			expect(amount).to.be.bignumber.equal(balanceAfter.sub(balanceBefore));
		});

		it("only owner should be able to transfer", async () => {
			await expectRevert(vesting.transferSOV(account1, 1000, { from: account1 }), "unauthorized");
		});

		it("fails if the 0 address is passed as receiver address", async () => {
			await expectRevert(vesting.transferSOV(ZERO_ADDRESS, 1000), "receiver address invalid");
		});

		it("fails if the 0 is passed as an amount", async () => {
			await expectRevert(vesting.transferSOV(account1, 0), "amount invalid");
		});
	});

	describe("createVesting", () => {
		it("should be able to create vesting - Bug Bounty", async () => {
			await vesting.initialize(
				vestingFactory.address,
				SOV.address,
				staking.address,
				feeSharingProxy.address,
				account1,
				lockedSOV.address,
				[vestingRegistry.address, vestingRegistry2.address, vestingRegistry3.address]
			);

			let amount = new BN(1000000);
			await SOV.transfer(vesting.address, amount);

			let cliff = FOUR_WEEKS;
			let duration = FOUR_WEEKS.mul(new BN(20));
			let vestingType = new BN(2); //Bug Bounty
			let tx = await vesting.createVestingAddr(account2, amount, cliff, duration, vestingType);
			let vestingAddress = await vesting.getVestingAddr(account2, cliff, duration, vestingType);
			await vesting.stakeTokens(vestingAddress, amount);

			expectEvent(tx, "VestingCreated", {
				tokenOwner: account2,
				vesting: vestingAddress,
				cliff: cliff,
				duration: duration,
				amount: amount,
				vestingCreationType: vestingType,
			});

			let balance = await SOV.balanceOf(vesting.address);
			expect(balance.toString()).equal("0");

			let vestingAddr = await VestingLogic.at(vestingAddress);
			await checkVesting(vestingAddr, account2, cliff, duration, amount);

			await expectRevert(vestingAddr.governanceWithdrawTokens(account2), "operation not supported");

			let proxy = await UpgradableProxy.at(vestingAddress);
			await expectRevert(proxy.setImplementation(account2), "revert");
		});

		it("should be able to create vesting - Team Salary", async () => {
			await vesting.initialize(
				vestingFactory.address,
				SOV.address,
				staking.address,
				feeSharingProxy.address,
				account1,
				lockedSOV.address,
				[vestingRegistry.address, vestingRegistry2.address, vestingRegistry3.address]
			);

			let amount = new BN(1000000);
			await SOV.transfer(vesting.address, amount);

			let cliff = FOUR_WEEKS;
			let duration = FOUR_WEEKS.mul(new BN(20));
			let vestingType = new BN(3); //Team Salary
			let tx = await vesting.createVestingAddr(account2, amount, cliff, duration, vestingType);
			let vestingAddress = await vesting.getVestingAddr(account2, cliff, duration, vestingType);
			await vesting.stakeTokens(vestingAddress, amount);

			expectEvent(tx, "VestingCreated", {
				tokenOwner: account2,
				vesting: vestingAddress,
				cliff: cliff,
				duration: duration,
				amount: amount,
				vestingCreationType: vestingType,
			});

			let balance = await SOV.balanceOf(vesting.address);
			expect(balance.toString()).equal("0");

			let vestingAddr = await VestingLogic.at(vestingAddress);
			await checkVesting(vestingAddr, account2, cliff, duration, amount);

			await expectRevert(vestingAddr.governanceWithdrawTokens(account2), "operation not supported");

			let proxy = await UpgradableProxy.at(vestingAddress);
			await expectRevert(proxy.setImplementation(account2), "revert");
		});

		it("fails if vestingRegistryLogic doesn't have enough SOV", async () => {
			await vesting.initialize(
				vestingFactory.address,
				SOV.address,
				staking.address,
				feeSharingProxy.address,
				account1,
				lockedSOV.address,
				[vestingRegistry.address, vestingRegistry2.address, vestingRegistry3.address]
			);

			let amount = new BN(1000000);
			let cliff = FOUR_WEEKS;
			let duration = FOUR_WEEKS.mul(new BN(20));
			let vestingType = new BN(3); //Team Salary

			await vesting.createVestingAddr(account2, amount, cliff, duration, vestingType);
			let vestingAddress = await vesting.getVestingAddr(account2, cliff, duration, vestingType);

			await expectRevert(vesting.stakeTokens(vestingAddress, amount), "ERC20: transfer amount exceeds balance");
		});

		it("fails if sender is not an owner or admin", async () => {
			await vesting.initialize(
				vestingFactory.address,
				SOV.address,
				staking.address,
				feeSharingProxy.address,
				account1,
				lockedSOV.address,
				[vestingRegistry.address, vestingRegistry2.address, vestingRegistry3.address]
			);

			let amount = new BN(1000000);
			let cliff = TEAM_VESTING_CLIFF;
			let duration = TEAM_VESTING_DURATION;
			let vestingType = new BN(3); //Team Salary

			await expectRevert(
				vesting.createVestingAddr(account2, amount, cliff, duration, vestingType, { from: account1 }),
				"unauthorized"
			);

			await vesting.addAdmin(account1);
			await vesting.createVestingAddr(account2, amount, cliff, duration, vestingType, { from: account1 });
		});
	});

	describe("createVesting and getVesting - LockedSOV", () => {
		it("Should create vesting and return the address for LockedSOV", async () => {
			await vesting.initialize(
				vestingFactory.address,
				SOV.address,
				staking.address,
				feeSharingProxy.address,
				account1,
				lockedSOV.address,
				[vestingRegistry.address, vestingRegistry2.address, vestingRegistry3.address]
			);

			let amount = new BN(1000000);
			await SOV.transfer(vesting.address, amount);
			await lockedSOV.createVesting({ from: accounts4 });
			let vestingAddr = await vesting.getVesting(accounts4);
			assert.notEqual(vestingAddr, ZERO_ADDRESS, "Vesting Address should not be zero.");
		});
	});

	describe("createTeamVesting", () => {
		it("should be able to create team vesting", async () => {
			await vesting.initialize(
				vestingFactory.address,
				SOV.address,
				staking.address,
				feeSharingProxy.address,
				account1,
				lockedSOV.address,
				[vestingRegistry.address, vestingRegistry2.address, vestingRegistry3.address]
			);

			let amount = new BN(1000000);
			await SOV.transfer(vesting.address, amount);

			let cliff = TEAM_VESTING_CLIFF;
			let duration = TEAM_VESTING_DURATION;
			let vestingType = new BN(3); //Team Salary
			let tx = await vesting.createTeamVesting(account2, amount, cliff, duration, vestingType);
			let vestingAddress = await vesting.getTeamVesting(account2, cliff, duration, vestingType);
			expectEvent(tx, "TeamVestingCreated", {
				tokenOwner: account2,
				vesting: vestingAddress,
				cliff: cliff,
				duration: duration,
				amount: amount,
				vestingCreationType: vestingType,
			});
			let tx2 = await vesting.stakeTokens(vestingAddress, amount);
			expectEvent(tx2, "TokensStaked", {
				vesting: vestingAddress,
				amount: amount,
			});
			let balance = await SOV.balanceOf(vestingRegistryLogic.address);
			expect(balance.toString()).equal("0");

			let vestingAddr = await VestingLogic.at(vestingAddress);
			await checkVesting(vestingAddr, account2, cliff, duration, amount);

			await expectRevert(vestingAddr.governanceWithdrawTokens(account2), "unauthorized");

			let proxy = await UpgradableProxy.at(vestingAddress);
			await expectRevert(proxy.setImplementation(account2), "revert");
		});

		it("fails if vestingRegistryLogic doesn't have enough SOV", async () => {
			await vesting.initialize(
				vestingFactory.address,
				SOV.address,
				staking.address,
				feeSharingProxy.address,
				account1,
				lockedSOV.address,
				[vestingRegistry.address, vestingRegistry2.address, vestingRegistry3.address]
			);

			let amount = new BN(1000000);
			let cliff = TEAM_VESTING_CLIFF;
			let duration = TEAM_VESTING_DURATION;
			let vestingType = new BN(3); //Team Salary

			await vesting.createTeamVesting(account2, amount, cliff, duration, vestingType);
			let vestingAddress = await vesting.getTeamVesting(account2, cliff, duration, vestingType);

			await expectRevert(vesting.stakeTokens(vestingAddress, amount), "ERC20: transfer amount exceeds balance");
		});

		it("fails if sender is not an owner or admin", async () => {
			await vesting.initialize(
				vestingFactory.address,
				SOV.address,
				staking.address,
				feeSharingProxy.address,
				account1,
				lockedSOV.address,
				[vestingRegistry.address, vestingRegistry2.address, vestingRegistry3.address]
			);

			let amount = new BN(1000000);
			let cliff = TEAM_VESTING_CLIFF;
			let duration = TEAM_VESTING_DURATION;
			let vestingType = new BN(3); //Team Salary

			await expectRevert(
				vesting.createTeamVesting(account2, amount, cliff, duration, vestingType, { from: account1 }),
				"unauthorized"
			);

			await vesting.addAdmin(account1);
			await vesting.createTeamVesting(account2, amount, cliff, duration, vestingType, { from: account1 });
		});
	});

	describe("stakeTokens", () => {
		it("fails if the 0 address is passed as vesting address", async () => {
			await expectRevert(vesting.stakeTokens(ZERO_ADDRESS, new BN(1000000)), "vesting address invalid");
		});

		it("fails if the 0 address is passed as an amount", async () => {
			await expectRevert(vesting.stakeTokens(account1, 0), "amount invalid");
		});

		it("only owner or admin should be able to stake tokens", async () => {
			await vesting.initialize(
				vestingFactory.address,
				SOV.address,
				staking.address,
				feeSharingProxy.address,
				account1,
				lockedSOV.address,
				[vestingRegistry.address, vestingRegistry2.address, vestingRegistry3.address]
			);

			let amount = new BN(1000000);
			await SOV.transfer(vesting.address, amount);

			let cliff = TEAM_VESTING_CLIFF;
			let duration = TEAM_VESTING_DURATION;
			let vestingType = new BN(3); //Team Salary
			await vesting.createTeamVesting(account2, amount, cliff, duration, vestingType);
			let vestingAddress = await vesting.getTeamVesting(account2, cliff, duration, vestingType);

			await expectRevert(vesting.stakeTokens(vestingAddress, new BN(1000000), { from: account1 }), "unauthorized");

			await vesting.addAdmin(account1);
			await vesting.stakeTokens(vestingAddress, new BN(1000000), { from: account1 });
		});
	});

	describe("getVestingsOf", () => {
		it("gets vesting of a user", async () => {
			await vesting.initialize(
				vestingFactory.address,
				SOV.address,
				staking.address,
				feeSharingProxy.address,
				account1,
				lockedSOV.address,
				[vestingRegistry.address, vestingRegistry2.address, vestingRegistry3.address]
			);

			let amount = new BN(1000000);
			await SOV.transfer(vesting.address, amount);

			//Vesting
			let cliff = FOUR_WEEKS;
			let duration = FOUR_WEEKS.mul(new BN(20));
			let vestingType = new BN(2); //Bug Bounty
			await vesting.createVestingAddr(account2, amount, cliff, duration, vestingType);

			//TeamVesting
			let teamCliff = TEAM_VESTING_CLIFF;
			let teamDuration = TEAM_VESTING_DURATION;
			vestingType = new BN(3); //Team Salary
			await vesting.createTeamVesting(account2, amount, teamCliff, teamDuration, vestingType);

			let vestingAddresses = await vesting.getVestingsOf(account2);
			assert.equal(vestingAddresses.length.toString(), "2");
			assert.equal(vestingAddresses[0].vestingCreationType, "2");
			assert.equal(vestingAddresses[1].vestingCreationType, "3");
		});
	});

	describe("getVestingDetails", () => {
		it("gets cliff, duration and amount for vesting address", async () => {
			await vesting.initialize(
				vestingFactory.address,
				SOV.address,
				staking.address,
				feeSharingProxy.address,
				account1,
				lockedSOV.address,
				[vestingRegistry.address, vestingRegistry2.address, vestingRegistry3.address]
			);

			let amount = new BN(1000000);
			await SOV.transfer(vesting.address, amount);

			//Vesting
			let cliff = FOUR_WEEKS;
			let duration = FOUR_WEEKS.mul(new BN(20));
			let vestingType = new BN(2); //Bug Bounty
			await vesting.createVestingAddr(account2, amount, cliff, duration, vestingType);
			let vestingAddr = await vesting.getVestingAddr(account2, cliff, duration, vestingType);
			let fields = await vesting.getVestingDetails(vestingAddr);
			expect(cliff).to.be.bignumber.equal(fields.cliff);
			expect(duration).to.be.bignumber.equal(fields.duration);
		});

		it("gets cliff, duration and amount for team vesting address", async () => {
			await vesting.initialize(
				vestingFactory.address,
				SOV.address,
				staking.address,
				feeSharingProxy.address,
				account1,
				lockedSOV.address,
				[vestingRegistry.address, vestingRegistry2.address, vestingRegistry3.address]
			);

			let amount = new BN(1000000);
			await SOV.transfer(vesting.address, amount);

			//TeamVesting
			let teamCliff = TEAM_VESTING_CLIFF;
			let teamDuration = TEAM_VESTING_DURATION;
			let vestingType = new BN(3); //Team Salary
			await vesting.createTeamVesting(account2, amount, teamCliff, teamDuration, vestingType);
			let vestingAddr = await vesting.getTeamVesting(account2, teamCliff, teamDuration, vestingType);
			let fields = await vesting.getVestingDetails(vestingAddr);
			expect(teamCliff).to.be.bignumber.equal(fields.cliff);
			expect(teamDuration).to.be.bignumber.equal(fields.duration);
		});
	});

	async function checkVesting(vesting, account, cliff, duration, amount) {
		await mineBlock();

		let vestingBalance = await staking.balanceOf(vesting.address);
		expect(vestingBalance).to.be.bignumber.equal(amount);

		let accountVotes = await staking.getCurrentVotes(account);
		expect(accountVotes).to.be.not.equal(new BN(0));
		let vestingVotes = await staking.getCurrentVotes(vesting.address);
		expect(vestingVotes).to.be.bignumber.equal(new BN(0));

		let startDate = await vesting.startDate();
		let start = startDate.toNumber() + cliff.toNumber();
		let end = startDate.toNumber() + duration.toNumber();

		let numIntervals = Math.floor((end - start) / FOUR_WEEKS) + 1;
		let stakedPerInterval = Math.floor(amount / numIntervals);

		let stakeForFirstInterval = amount - stakedPerInterval * (numIntervals - 1);

		expect(await vesting.cliff()).to.be.bignumber.equal(cliff);
		expect(await vesting.duration()).to.be.bignumber.equal(duration);

		for (let i = start; i <= end; i += FOUR_WEEKS) {
			let lockedTS = await staking.timestampToLockDate(i);

			let numUserStakingCheckpoints = await staking.numUserStakingCheckpoints(vesting.address, lockedTS);
			let userStakingCheckpoints = await staking.userStakingCheckpoints(vesting.address, lockedTS, numUserStakingCheckpoints - 1);
			assert.equal(numUserStakingCheckpoints.toString(), "1");
			if (i === start) {
				assert.equal(userStakingCheckpoints.stake.toString(), stakeForFirstInterval);
			} else {
				assert.equal(userStakingCheckpoints.stake.toString(), stakedPerInterval);
			}

			let numDelegateStakingCheckpoints = await staking.numDelegateStakingCheckpoints(account, lockedTS);
			let delegateStakingCheckpoints = await staking.delegateStakingCheckpoints(account, lockedTS, numUserStakingCheckpoints - 1);
			assert.equal(numDelegateStakingCheckpoints.toString(), "1");
			if (i === start) {
				assert.equal(delegateStakingCheckpoints.stake.toString(), stakeForFirstInterval);
			} else {
				assert.equal(delegateStakingCheckpoints.stake.toString(), stakedPerInterval);
			}
		}
	}
});
