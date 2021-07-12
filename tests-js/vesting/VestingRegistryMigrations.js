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

contract("VestingRegistryMigrations", (accounts) => {
	let root, account1, account2, account3, account4;
	let SOV, lockedSOV;
	let staking, stakingLogic, feeSharingProxy;
	let vesting, vestingFactory, vestingLogic, vestingRegistryLogic;
	let vestingRegistry, vestingRegistry2, vestingRegistry3;
	let vestingAddress, vestingAddress2, vestingAddress3;
	let vestingTeamAddress, vestingTeamAddress2, vestingTeamAddress3;
	let newVestingAddress, newVestingAddress2, newVestingAddress3;
	let newTeamVestingAddress, newTeamVestingAddress2, newTeamVestingAddress3;

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

		lockedSOV = await LockedSOV.new(SOV.address, vesting.address, cliff, duration, [root]);
		await vesting.addAdmin(lockedSOV.address);
	});

	describe("addDeployedVestings", () => {
		it("adds deployed vestings from VestingRegistry ", async () => {
			vestingRegistry = await VestingRegistry.new(
				vestingFactory.address,
				SOV.address,
				[cSOV1.address, cSOV2.address],
				pricsSats,
				staking.address,
				feeSharingProxy.address,
				account1
			);

			let amt = new BN(2000000);
			let amount = new BN(200000);
			await SOV.transfer(vestingRegistry.address, amt);

			let cliff = FOUR_WEEKS;
			let duration = FOUR_WEEKS.mul(new BN(20));
			let teamCliff = TEAM_VESTING_CLIFF;
			let teamDuration = TEAM_VESTING_DURATION;

			await vestingFactory.transferOwnership(vestingRegistry.address);
			await vestingRegistry.createVesting(account1, amount, cliff, duration);
			vestingAddress = await vestingRegistry.getVesting(account1);
			await vestingRegistry.stakeTokens(vestingAddress, amount);
			await vestingRegistry.createTeamVesting(account1, amount, teamCliff, teamDuration);
			vestingTeamAddress = await vestingRegistry.getTeamVesting(account1);
			await vestingRegistry.stakeTokens(vestingTeamAddress, amount);
			assert.notEqual(vestingAddress, ZERO_ADDRESS, "Vesting Address should not be zero.");
			assert.notEqual(vestingTeamAddress, ZERO_ADDRESS, "Vesting Team Address should not be zero.");
		});

		it("adds deployed vestings from VestingRegistry2 ", async () => {
			vestingRegistry2 = await VestingRegistry2.new(
				vestingFactory.address,
				SOV.address,
				[cSOV1.address, cSOV2.address],
				pricsSats,
				staking.address,
				feeSharingProxy.address,
				account1
			);

			let amt = new BN(2000000);
			let amount = new BN(200000);
			await SOV.transfer(vestingRegistry2.address, amt);

			let cliff = FOUR_WEEKS;
			let duration = FOUR_WEEKS.mul(new BN(20));
			let teamCliff = TEAM_VESTING_CLIFF;
			let teamDuration = TEAM_VESTING_DURATION;

			await vestingFactory.transferOwnership(vestingRegistry2.address);
			await vestingRegistry2.createVesting(account2, amount, cliff, duration);
			vestingAddress2 = await vestingRegistry2.getVesting(account2);
			let tx = await vestingRegistry2.stakeTokens(vestingAddress2, amount);
			expectEvent(tx, "TokensStaked", {
				vesting: vestingAddress2,
				amount: amount,
			});
			await staking.balanceOf(vestingAddress2);
			await vestingRegistry2.createTeamVesting(account2, amount, teamCliff, teamDuration);
			vestingTeamAddress2 = await vestingRegistry2.getTeamVesting(account2);
			let tx2 = await vestingRegistry2.stakeTokens(vestingTeamAddress2, amount);
			expectEvent(tx2, "TokensStaked", {
				vesting: vestingTeamAddress2,
				amount: amount,
			});
			assert.notEqual(vestingAddress2, ZERO_ADDRESS, "Vesting Address should not be zero.");
			assert.notEqual(vestingTeamAddress2, ZERO_ADDRESS, "Vesting Team Address should not be zero.");
		});

		it("adds deployed vestings from VestingRegistry3 ", async () => {
			vestingRegistry3 = await VestingRegistry3.new(
				vestingFactory.address,
				SOV.address,
				staking.address,
				feeSharingProxy.address,
				account1
			);

			let amt = new BN(2000000);
			let amount = new BN(200000);
			await SOV.transfer(vestingRegistry3.address, amt);

			let cliff = FOUR_WEEKS;
			let duration = FOUR_WEEKS.mul(new BN(20));
			let teamCliff = TEAM_VESTING_CLIFF;
			let teamDuration = TEAM_VESTING_DURATION;

			await vestingFactory.transferOwnership(vestingRegistry3.address);
			await vestingRegistry3.createVesting(account3, amount, cliff, duration);
			vestingAddress3 = await vestingRegistry3.getVesting(account3);
			await vestingRegistry3.stakeTokens(vestingAddress3, amount);
			await vestingRegistry3.createTeamVesting(account3, amount, teamCliff, teamDuration);
			vestingTeamAddress3 = await vestingRegistry3.getTeamVesting(account3);
			await vestingRegistry3.stakeTokens(vestingTeamAddress3, amount);
			assert.notEqual(vestingAddress3, ZERO_ADDRESS, "Vesting Address should not be zero.");
			assert.notEqual(vestingTeamAddress3, ZERO_ADDRESS, "Vesting Team Address should not be zero.");
		});

		it("adds deployed vestings to new Vesting Registry ", async () => {
			await vesting.initialize(
				vestingFactory.address,
				SOV.address,
				staking.address,
				feeSharingProxy.address,
				account1,
				lockedSOV.address,
				[vestingRegistry.address, vestingRegistry2.address, vestingRegistry3.address]
			);

			let cliff = FOUR_WEEKS;
			let duration = FOUR_WEEKS.mul(new BN(20));
			let teamCliff = TEAM_VESTING_CLIFF;
			let teamDuration = TEAM_VESTING_DURATION;

			vestingFactory.transferOwnership(vesting.address);
			let tx = await vesting.addDeployedVestings([account1, account2, account3], [2, 3, 4]);
			console.log("gasUsed = " + tx.receipt.gasUsed);

			newVestingAddress = await vesting.getVestingAddr(account1, cliff, duration, 2);
			newVestingAddress2 = await vesting.getVestingAddr(account2, cliff, duration, 3);
			newVestingAddress3 = await vesting.getVestingAddr(account3, cliff, duration, 4);
			newTeamVestingAddress = await vesting.getTeamVesting(account1, teamCliff, teamDuration, 2);
			newTeamVestingAddress2 = await vesting.getTeamVesting(account2, teamCliff, teamDuration, 3);
			newTeamVestingAddress3 = await vesting.getTeamVesting(account3, teamCliff, teamDuration, 4);

			expect(vestingAddress).equal(newVestingAddress);
			expect(vestingAddress2).equal(newVestingAddress2);
			expect(vestingAddress3).equal(newVestingAddress3);
			expect(vestingTeamAddress).equal(newTeamVestingAddress);
			expect(vestingTeamAddress2).equal(newTeamVestingAddress2);
			expect(vestingTeamAddress3).equal(newTeamVestingAddress3);

			let vestingAddresses = await vesting.getVestingsOf(account2);
			assert.equal(vestingAddresses.length.toString(), "2");
			assert.equal(vestingAddresses[0].vestingType, 1);
			assert.equal(vestingAddresses[0].vestingCreationType, 3);
			assert.equal(vestingAddresses[0].vestingAddress, newVestingAddress2);
			assert.equal(vestingAddresses[1].vestingType, 0);
			assert.equal(vestingAddresses[1].vestingCreationType, 3);
			assert.equal(vestingAddresses[1].vestingAddress, newTeamVestingAddress2);
		});

		it("fails if the 0 address is passed", async () => {
			await expectRevert(vesting.addDeployedVestings([ZERO_ADDRESS], [1]), "token owner cannot be 0 address");
		});

		it("fails if the 0 address is passed", async () => {
			await expectRevert(vesting.addDeployedVestings([account1], [0]), "vesting creation type must be greater than 0");
		});

		it("fails if sender isn't an owner", async () => {
			await expectRevert(vesting.addDeployedVestings([account1], [1], { from: account2 }), "unauthorized");
		});
	});
});
