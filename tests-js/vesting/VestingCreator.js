const { expect } = require("chai");
const { expectRevert, expectEvent, constants, BN } = require("@openzeppelin/test-helpers");
const StakingLogic = artifacts.require("Staking");
const StakingProxy = artifacts.require("StakingProxy");
const SOV_ABI = artifacts.require("SOV");
const FeeSharingProxy = artifacts.require("FeeSharingProxyMockup");
const VestingLogic = artifacts.require("VestingLogic");
const VestingFactory = artifacts.require("VestingFactory");
const VestingRegistryLogic = artifacts.require("VestingRegistryLogic");
const VestingRegistryProxy = artifacts.require("VestingRegistryProxy");
const VestingCreator = artifacts.require("VestingCreator");
const LockedSOV = artifacts.require("LockedSOV");
const VestingRegistry = artifacts.require("VestingRegistry");
const VestingRegistry2 = artifacts.require("VestingRegistry2");
const VestingRegistry3 = artifacts.require("VestingRegistry3");
const TestToken = artifacts.require("TestToken");

const TOTAL_SUPPLY = "100000000000000000000000000";
const ZERO_ADDRESS = constants.ZERO_ADDRESS;
const WEEK = new BN(7 * 24 * 60 * 60);
const FOUR_WEEKS = 4 * WEEK;
const MAX_PERIOD = 8;
const pricsSats = "2500";

contract("VestingCreator", (accounts) => {
	let root, account1, account2, account3, account4, account5;
	let SOV, lockedSOV;
	let vesting, vestingRegistryLogic;
	let vestingCreator;
	let vestingRegistry, vestingRegistry2, vestingRegistry3;

	let cliff = 1; // This is in 4 weeks. i.e. 1 * 4 weeks.
	let duration = 11; // This is in 4 weeks. i.e. 11 * 4 weeks.

	before(async () => {
		[root, account1, account2, account3, account4, account5, ...accounts] = accounts;
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

		vestingCreator = await VestingCreator.new(SOV.address, vesting.address);

		lockedSOV = await LockedSOV.new(SOV.address, vesting.address, cliff, duration, [root]);

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

		await vesting.initialize(
			vestingFactory.address,
			SOV.address,
			staking.address,
			feeSharingProxy.address,
			account4,
			lockedSOV.address,
			[vestingRegistry.address, vestingRegistry2.address, vestingRegistry3.address]
		);

		await vesting.addAdmin(vestingCreator.address);
	});

	describe("constructor", () => {
		it("sets the expected values", async () => {
			let _sov = await vestingCreator.SOV();
			let _vestingRegistryLogic = await vestingCreator.vestingRegistryLogic();

			expect(_sov).equal(SOV.address);
			expect(_vestingRegistryLogic).equal(vesting.address);
		});

		it("fails if the 0 address is passed as SOV Address", async () => {
			await expectRevert(VestingCreator.new(ZERO_ADDRESS, vesting.address), "SOV address invalid");
		});

		it("fails if the 0 address is passed as Vesting Registry Address", async () => {
			await expectRevert(VestingCreator.new(SOV.address, ZERO_ADDRESS), "Vesting registry address invalid");
		});
	});

	describe("transferSOV", () => {
		it("should be able to transfer SOV", async () => {
			let amount = new BN(1000);
			await SOV.transfer(vestingCreator.address, amount);

			let balanceBefore = await SOV.balanceOf(account1);
			let tx = await vestingCreator.transferSOV(account1, amount);
			expectEvent(tx, "SOVTransferred", {
				receiver: account1,
				amount: amount,
			});
			let balanceAfter = await SOV.balanceOf(account1);

			expect(amount).to.be.bignumber.equal(balanceAfter.sub(balanceBefore));
		});

		it("only owner should be able to transfer", async () => {
			await expectRevert(vestingCreator.transferSOV(account1, 1000, { from: account1 }), "unauthorized");
		});

		it("fails if the 0 address is passed as receiver address", async () => {
			await expectRevert(vestingCreator.transferSOV(ZERO_ADDRESS, 1000), "receiver address invalid");
		});

		it("fails if the 0 is passed as an amount", async () => {
			await expectRevert(vestingCreator.transferSOV(account1, 0), "amount invalid");
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

	describe("add vestings", () => {
		it("fails if the input arrays has mismatch", async () => {
			await expectRevert(
				vestingCreator.addVestings(
					[account1, account2, account3, account1, account1],
					[new BN(3787.24), new BN(627.22), new BN(156.8), new BN(627.22), new BN(1000)],
					[1 * FOUR_WEEKS, 1 * FOUR_WEEKS, 1 * FOUR_WEEKS, 1 * FOUR_WEEKS, 26 * FOUR_WEEKS],
					[26 * FOUR_WEEKS, 26 * FOUR_WEEKS, 26 * FOUR_WEEKS, 26 * FOUR_WEEKS],
					[false, false, true, true, false],
					[1, 1, 1, 1, 1]
				),
				"arrays mismatch"
			);
		});

		it("fails if durations is greater than cliff for any vesting contract", async () => {
			await expectRevert(
				vestingCreator.addVestings(
					[account1, account2, account3, account1, account1],
					[new BN(3787.24), new BN(627.22), new BN(156.8), new BN(627.22), new BN(1000)],
					[1 * FOUR_WEEKS, 1 * FOUR_WEEKS, 1 * FOUR_WEEKS, 1 * FOUR_WEEKS, 106 * FOUR_WEEKS],
					[26 * FOUR_WEEKS, 26 * FOUR_WEEKS, 26 * FOUR_WEEKS, 26 * FOUR_WEEKS, 104 * FOUR_WEEKS],
					[false, false, true, true, false],
					[1, 1, 1, 1, 1]
				),
				"duration must be bigger than or equal to the cliff"
			);
		});

		it("fails if amount is 0", async () => {
			await expectRevert(
				vestingCreator.addVestings(
					[account1, account2, account3, account1, account1],
					[new BN(0), new BN(627.22), new BN(156.8), new BN(627.22), new BN(1000)],
					[1 * FOUR_WEEKS, 1 * FOUR_WEEKS, 1 * FOUR_WEEKS, 1 * FOUR_WEEKS, 106 * FOUR_WEEKS],
					[26 * FOUR_WEEKS, 26 * FOUR_WEEKS, 26 * FOUR_WEEKS, 26 * FOUR_WEEKS, 104 * FOUR_WEEKS],
					[false, false, true, true, false],
					[1, 1, 1, 1, 1]
				),
				"vesting amount cannot be 0"
			);
		});

		it("fails if token owner address is 0", async () => {
			await expectRevert(
				vestingCreator.addVestings(
					[ZERO_ADDRESS, account2, account3, account1, account1],
					[new BN(3787.24), new BN(627.22), new BN(156.8), new BN(627.22), new BN(1000)],
					[1 * FOUR_WEEKS, 1 * FOUR_WEEKS, 1 * FOUR_WEEKS, 1 * FOUR_WEEKS, 106 * FOUR_WEEKS],
					[26 * FOUR_WEEKS, 26 * FOUR_WEEKS, 26 * FOUR_WEEKS, 26 * FOUR_WEEKS, 104 * FOUR_WEEKS],
					[false, false, true, true, false],
					[1, 1, 1, 1, 1]
				),
				"token owner cannot be 0 address"
			);
		});

		it("fails if cliff does not have interval of two weeks", async () => {
			await expectRevert(
				vestingCreator.addVestings(
					[account1, account2, account3, account1, account1],
					[new BN(3787.24), new BN(627.22), new BN(156.8), new BN(627.22), new BN(1000)],
					[1 * WEEK, 1 * FOUR_WEEKS, 1 * FOUR_WEEKS, 1 * FOUR_WEEKS, 1 * FOUR_WEEKS],
					[26 * FOUR_WEEKS, 26 * FOUR_WEEKS, 26 * FOUR_WEEKS, 26 * FOUR_WEEKS, 26 * FOUR_WEEKS],
					[false, false, true, true, false],
					[1, 1, 1, 1, 1]
				),
				"cliffs should have intervals of two weeks"
			);
		});

		it("fails if duration does not have interval of two weeks", async () => {
			await expectRevert(
				vestingCreator.addVestings(
					[account1, account2, account3, account1, account1],
					[new BN(3787.24), new BN(627.22), new BN(156.8), new BN(627.22), new BN(1000)],
					[2 * WEEK, 1 * FOUR_WEEKS, 1 * FOUR_WEEKS, 1 * FOUR_WEEKS, 1 * FOUR_WEEKS],
					[3 * WEEK, 26 * FOUR_WEEKS, 26 * FOUR_WEEKS, 26 * FOUR_WEEKS, 26 * FOUR_WEEKS],
					[false, false, true, true, false],
					[1, 1, 1, 1, 1]
				),
				"durations should have intervals of two weeks"
			);
		});

		it("adds the vesting", async () => {
			let amount = new BN(1000000);
			await SOV.transfer(vestingCreator.address, amount);

			await vestingCreator.addVestings(
				[account1, account2, account3, account1, account1],
				[new BN(3787), new BN(627), new BN(156), new BN(627), new BN(1000)],
				[1 * FOUR_WEEKS, 1 * FOUR_WEEKS, 1 * FOUR_WEEKS, 1 * FOUR_WEEKS, 26 * FOUR_WEEKS],
				[26 * FOUR_WEEKS, 26 * FOUR_WEEKS, 26 * FOUR_WEEKS, 26 * FOUR_WEEKS, 104 * FOUR_WEEKS],
				[false, false, true, true, false],
				[1, 1, 1, 1, 1]
			);

			let count = await vestingCreator.getUnprocessedCount();
			expect(count).to.be.bignumber.equal("5");

			let totalUnprocessedAmount = await vestingCreator.getUnprocessedAmount();
			expect(totalUnprocessedAmount).to.be.bignumber.equal("6197");

			let isEnoughBalance = await vestingCreator.isEnoughBalance();
			expect(isEnoughBalance).equal(true);
		});

		it("stress test - adds the vesting", async () => {
			let amount = new BN(1000000);
			await SOV.transfer(vestingCreator.address, amount);

			let tx = await vestingCreator.addVestings(
				[
					account1,
					account2,
					account3,
					account1,
					account1,
					account1,
					account2,
					account3,
					account1,
					account1,
					account1,
					account2,
					account3,
					account1,
					account1,
					account1,
					account2,
					account3,
					account1,
					account1,
					account1,
					account2,
					account3,
					account1,
					account1,
					account1,
					account2,
					account3,
					account1,
					account1,
					account1,
					account2,
					account3,
					account1,
					account1,
					account1,
					account2,
					account3,
					account1,
					account1,
					account1,
					account2,
					account3,
					account1,
					account1,
					account1,
					account2,
					account3,
					account1,
					account1,
				],
				[
					new BN(3787),
					new BN(627),
					new BN(156),
					new BN(627),
					new BN(1000),
					new BN(3787),
					new BN(627),
					new BN(156),
					new BN(627),
					new BN(1000),
					new BN(3787),
					new BN(627),
					new BN(156),
					new BN(627),
					new BN(1000),
					new BN(3787),
					new BN(627),
					new BN(156),
					new BN(627),
					new BN(1000),
					new BN(3787),
					new BN(627),
					new BN(156),
					new BN(627),
					new BN(1000),
					new BN(3787),
					new BN(627),
					new BN(156),
					new BN(627),
					new BN(1000),
					new BN(3787),
					new BN(627),
					new BN(156),
					new BN(627),
					new BN(1000),
					new BN(3787),
					new BN(627),
					new BN(156),
					new BN(627),
					new BN(1000),
					new BN(3787),
					new BN(627),
					new BN(156),
					new BN(627),
					new BN(1000),
					new BN(3787),
					new BN(627),
					new BN(156),
					new BN(627),
					new BN(1000),
				],
				[
					1 * FOUR_WEEKS,
					1 * FOUR_WEEKS,
					1 * FOUR_WEEKS,
					1 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
					1 * FOUR_WEEKS,
					1 * FOUR_WEEKS,
					1 * FOUR_WEEKS,
					1 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
					1 * FOUR_WEEKS,
					1 * FOUR_WEEKS,
					1 * FOUR_WEEKS,
					1 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
					1 * FOUR_WEEKS,
					1 * FOUR_WEEKS,
					1 * FOUR_WEEKS,
					1 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
					1 * FOUR_WEEKS,
					1 * FOUR_WEEKS,
					1 * FOUR_WEEKS,
					1 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
					1 * FOUR_WEEKS,
					1 * FOUR_WEEKS,
					1 * FOUR_WEEKS,
					1 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
					1 * FOUR_WEEKS,
					1 * FOUR_WEEKS,
					1 * FOUR_WEEKS,
					1 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
					1 * FOUR_WEEKS,
					1 * FOUR_WEEKS,
					1 * FOUR_WEEKS,
					1 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
					1 * FOUR_WEEKS,
					1 * FOUR_WEEKS,
					1 * FOUR_WEEKS,
					1 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
					1 * FOUR_WEEKS,
					1 * FOUR_WEEKS,
					1 * FOUR_WEEKS,
					1 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
				],
				[
					26 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
					104 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
					104 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
					104 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
					104 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
					104 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
					104 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
					104 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
					104 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
					104 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
					26 * FOUR_WEEKS,
					104 * FOUR_WEEKS,
				],
				[
					false,
					false,
					true,
					true,
					false,
					false,
					false,
					true,
					true,
					false,
					false,
					false,
					true,
					true,
					false,
					false,
					false,
					true,
					true,
					false,
					false,
					false,
					true,
					true,
					false,
					false,
					false,
					true,
					true,
					false,
					false,
					false,
					true,
					true,
					false,
					false,
					false,
					true,
					true,
					false,
					false,
					false,
					true,
					true,
					false,
					false,
					false,
					true,
					true,
					false,
				],
				[
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
					1,
				]
			);

			console.log("gasUsed = " + tx.receipt.gasUsed);
			web3.eth.getBlock("latest", false, (error, result) => {
				console.log(result.gasLimit);
			});

			let count = await vestingCreator.getUnprocessedCount();
			expect(count).to.be.bignumber.equal("50");

			let totalUnprocessedAmount = await vestingCreator.getUnprocessedAmount();
			expect(totalUnprocessedAmount).to.be.bignumber.equal("61970");

			let isEnoughBalance = await vestingCreator.isEnoughBalance();
			expect(isEnoughBalance).equal(true);
		});
	});

	describe("process vesting creation and staking", () => {
		it("process vesting creation and staking in a single txn", async () => {
			let amount = new BN(1000000);
			await SOV.transfer(vestingCreator.address, amount);

			await vestingCreator.addVestings(
				[account1, account2, account3, account1, account1],
				[new BN(3787.24), new BN(627.22), new BN(156.8), new BN(627.22), new BN(1000)],
				[1 * FOUR_WEEKS, 1 * FOUR_WEEKS, 1 * FOUR_WEEKS, 1 * FOUR_WEEKS, 1 * FOUR_WEEKS],
				[26 * FOUR_WEEKS, 26 * FOUR_WEEKS, 26 * FOUR_WEEKS, 26 * FOUR_WEEKS, 9 * FOUR_WEEKS],
				[false, false, true, true, true],
				[1, 1, 1, 1, 1]
			);

			let period = await vestingCreator.getVestingPeriod();
			if (period <= MAX_PERIOD) {
				let tx = await vestingCreator.processNextVesting();
				console.log("gasUsed = " + tx.receipt.gasUsed);
				let count = await vestingCreator.getUnprocessedCount();
				expect(count).to.be.bignumber.equal("4");
			}
		});

		it("process vesting creation and staking separately", async () => {
			let amount = new BN(1000000);
			await SOV.transfer(vestingCreator.address, amount);

			await vestingCreator.addVestings(
				[account1, account2, account3, account1, account1],
				[new BN(3787.24), new BN(627.22), new BN(156.8), new BN(627.22), new BN(1000)],
				[1 * FOUR_WEEKS, 1 * FOUR_WEEKS, 1 * FOUR_WEEKS, 1 * FOUR_WEEKS, 1 * FOUR_WEEKS],
				[26 * FOUR_WEEKS, 26 * FOUR_WEEKS, 26 * FOUR_WEEKS, 26 * FOUR_WEEKS, 10 * FOUR_WEEKS],
				[false, false, true, true, false],
				[1, 1, 1, 1, 1]
			);

			let period = await vestingCreator.getVestingPeriod();
			if (period > MAX_PERIOD) {
				let tx = await vestingCreator.processVestingCreation();
				console.log("gasUsed = " + tx.receipt.gasUsed);
				let vestingAddr = await vestingCreator.getVestingAddress();
				tx = await vestingCreator.processStaking();
				console.log("gasUsed = " + tx.receipt.gasUsed);

				expectEvent(tx, "TokensStaked", {
					vesting: vestingAddr,
					tokenOwner: account1,
					amount: new BN(1000),
				});

				expectEvent(tx, "VestingDataRemoved", {
					caller: root,
					tokenOwner: account1,
				});

				let count = await vestingCreator.getUnprocessedCount();
				expect(count).to.be.bignumber.equal("4");
			}
		});

		it("fails if sender isn't an owner", async () => {
			await expectRevert(vestingCreator.processVestingCreation({ from: account1 }), "unauthorized");
		});

		it("vesting creation fails if staking is not done for previous creation", async () => {
			await vestingCreator.addVestings(
				[account1, account2, account3, account1, account1],
				[new BN(3787.24), new BN(627.22), new BN(156.8), new BN(627.22), new BN(1000)],
				[1 * FOUR_WEEKS, 1 * FOUR_WEEKS, 1 * FOUR_WEEKS, 1 * FOUR_WEEKS, 1 * FOUR_WEEKS],
				[26 * FOUR_WEEKS, 26 * FOUR_WEEKS, 26 * FOUR_WEEKS, 26 * FOUR_WEEKS, 10 * FOUR_WEEKS],
				[false, false, true, true, false],
				[1, 1, 1, 1, 1]
			);
			await vestingCreator.processVestingCreation();
			await expectRevert(vestingCreator.processVestingCreation(), "staking not done for the previous vesting");
		});

		it("staking fails if vesting is not created", async () => {
			await expectRevert(vestingCreator.processStaking(), "cannot stake without vesting creation");
		});
	});

	describe("get missing balance", () => {
		it("returns missing balance", async () => {
			let amount = new BN(1000);
			await SOV.transfer(vestingCreator.address, amount);

			await vestingCreator.addVestings(
				[account1, account2, account3, account1, account1],
				[new BN(3787), new BN(627), new BN(156), new BN(627), new BN(1000)],
				[1 * FOUR_WEEKS, 1 * FOUR_WEEKS, 1 * FOUR_WEEKS, 1 * FOUR_WEEKS, 26 * FOUR_WEEKS],
				[26 * FOUR_WEEKS, 26 * FOUR_WEEKS, 26 * FOUR_WEEKS, 26 * FOUR_WEEKS, 104 * FOUR_WEEKS],
				[false, false, true, true, false],
				[1, 1, 1, 1, 1]
			);

			let balance = await vestingCreator.getMissingBalance();
			expect(balance).to.be.bignumber.equal("5197");
		});

		it("returns 0 if no missing balance", async () => {
			let amount = new BN(10000);
			await SOV.transfer(vestingCreator.address, amount);

			await vestingCreator.addVestings(
				[account1, account2, account3, account1, account1],
				[new BN(3787), new BN(627), new BN(156), new BN(627), new BN(1000)],
				[1 * FOUR_WEEKS, 1 * FOUR_WEEKS, 1 * FOUR_WEEKS, 1 * FOUR_WEEKS, 26 * FOUR_WEEKS],
				[26 * FOUR_WEEKS, 26 * FOUR_WEEKS, 26 * FOUR_WEEKS, 26 * FOUR_WEEKS, 104 * FOUR_WEEKS],
				[false, false, true, true, false],
				[1, 1, 1, 1, 1]
			);

			let balance = await vestingCreator.getMissingBalance();
			expect(balance).to.be.bignumber.equal("0");
		});
	});

	describe("remove vesting", () => {
		it("removes the vesting", async () => {
			let amount = new BN(1000);
			await SOV.transfer(vestingCreator.address, amount);

			await vestingCreator.addVestings(
				[account1, account2, account3, account1, account1],
				[new BN(3787), new BN(627), new BN(156), new BN(627), new BN(1000)],
				[1 * FOUR_WEEKS, 1 * FOUR_WEEKS, 1 * FOUR_WEEKS, 1 * FOUR_WEEKS, 1 * FOUR_WEEKS],
				[26 * FOUR_WEEKS, 26 * FOUR_WEEKS, 26 * FOUR_WEEKS, 26 * FOUR_WEEKS, 26 * FOUR_WEEKS],
				[false, false, true, true, false],
				[1, 1, 1, 1, 1]
			);

			let tx = await vestingCreator.removeNextVesting();
			expectEvent(tx, "VestingDataRemoved", {
				caller: root,
				tokenOwner: account1,
			});
			let count = await vestingCreator.getUnprocessedCount();
			expect(count).to.be.bignumber.equal("4");
		});
	});

	describe("clear vesting data list", () => {
		it("clears the vesting list", async () => {
			let amount = new BN(1000);
			await SOV.transfer(vestingCreator.address, amount);

			await vestingCreator.addVestings(
				[account1, account2, account3, account1, account1],
				[new BN(3787), new BN(627), new BN(156), new BN(627), new BN(1000)],
				[1 * FOUR_WEEKS, 1 * FOUR_WEEKS, 1 * FOUR_WEEKS, 1 * FOUR_WEEKS, 1 * FOUR_WEEKS],
				[26 * FOUR_WEEKS, 26 * FOUR_WEEKS, 26 * FOUR_WEEKS, 26 * FOUR_WEEKS, 26 * FOUR_WEEKS],
				[false, false, true, true, false],
				[1, 1, 1, 1, 1]
			);

			let tx = await vestingCreator.clearVestingDataList();
			let count = await vestingCreator.getUnprocessedCount();
			expect(count).to.be.bignumber.equal("0");

			expectEvent(tx, "DataCleared", {
				caller: root,
			});
		});
	});
});
