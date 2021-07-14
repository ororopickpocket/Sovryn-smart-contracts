const SOV = artifacts.require("TestToken");
const TestWrbtc = artifacts.require("TestWrbtc");
const LockedSOV = artifacts.require("LockedSOV");
const StakingLogic = artifacts.require("Staking");
const StakingProxy = artifacts.require("StakingProxy");
const FeeSharingProxy = artifacts.require("FeeSharingProxyMockup");
const VestingLogic = artifacts.require("VestingLogic");
const VestingFactory = artifacts.require("VestingFactory");
const VestingRegistry = artifacts.require("VestingRegistry3");

const {
	BN, // Big Number support.
	expectEvent,
	constants, // Assertions for transactions that should fail.
} = require("@openzeppelin/test-helpers");

const { assert } = require("chai");

// Some constants we would be using in the contract.
let zero = new BN(0);
let zeroAddress = constants.ZERO_ADDRESS;
let cliff = 1; // This is in 4 weeks. i.e. 1 * 4 weeks.
let duration = 11; // This is in 4 weeks. i.e. 11 * 4 weeks.

/**
 * Function to create a random value.
 * It expects no parameter.
 *
 * @return {number} Random Value.
 */
function randomValue() {
	return Math.floor(Math.random() * 10000);
}

contract("Locked SOV (Events)", (accounts) => {
	let sov, lockedSOV, newLockedSOV, vestingRegistry, vestingLogic, stakingLogic;
	let creator, admin, newAdmin, userOne, userTwo, userThree, userFour, userFive;

	before("Initiating Accounts & Creating Test Token Instance.", async () => {
		// Checking if we have enough accounts to test.
		assert.isAtLeast(accounts.length, 8, "Alteast 8 accounts are required to test the contracts.");
		[creator, admin, newAdmin, userOne, userTwo, userThree, userFour, userFive] = accounts;

		// Creating the instance of SOV Token.
		sov = await SOV.new("Sovryn", "SOV", 18, zero);
		wrbtc = await TestWrbtc.new();

		// Creating the Staking Instance.
		stakingLogic = await StakingLogic.new(sov.address);
		staking = await StakingProxy.new(sov.address);
		await staking.setImplementation(stakingLogic.address);
		staking = await StakingLogic.at(staking.address);

		// Creating the FeeSharing Instance.
		feeSharingProxy = await FeeSharingProxy.new(zeroAddress, staking.address, wrbtc.address);

		// Creating the Vesting Instance.
		vestingLogic = await VestingLogic.new();
		vestingFactory = await VestingFactory.new(vestingLogic.address);
		vestingRegistry = await VestingRegistry.new(
			vestingFactory.address,
			sov.address,
			staking.address,
			feeSharingProxy.address,
			creator // This should be Governance Timelock Contract.
		);
		vestingFactory.transferOwnership(vestingRegistry.address);

		// Creating the instance of newLockedSOV Contract.
		newLockedSOV = await LockedSOV.new(sov.address, vestingRegistry.address, cliff, duration, [admin]);
	});

	beforeEach("Creating New Locked SOV Contract Instance.", async () => {
		// Creating the instance of LockedSOV Contract.
		lockedSOV = await LockedSOV.new(sov.address, vestingRegistry.address, cliff, duration, [admin]);

		// Adding lockedSOV as an admin in the Vesting Registry.
		await vestingRegistry.addAdmin(lockedSOV.address);
	});

	it("Adding another admin should emit AdminAdded.", async () => {
		let txReceipt = await lockedSOV.addAdmin(newAdmin, { from: admin });
		expectEvent(txReceipt, "AdminAdded", {
			_initiator: admin,
			_newAdmin: newAdmin,
		});
	});

	it("Removing an admin should emit AdminRemoved.", async () => {
		await lockedSOV.addAdmin(newAdmin, { from: admin });
		let txReceipt = await lockedSOV.removeAdmin(newAdmin, { from: admin });
		expectEvent(txReceipt, "AdminRemoved", {
			_initiator: admin,
			_removedAdmin: newAdmin,
		});
	});

	it("Changing the vestingRegistry, cliff and/or duration should emit RegistryCliffAndDurationUpdated.", async () => {
		let newVestingRegistry = await VestingRegistry.new(
			vestingFactory.address,
			sov.address,
			staking.address,
			feeSharingProxy.address,
			creator // This should be Governance Timelock Contract.
		);
		let txReceipt = await lockedSOV.changeRegistryCliffAndDuration(newVestingRegistry.address, cliff + 1, duration + 1, {
			from: admin,
		});
		expectEvent(txReceipt, "RegistryCliffAndDurationUpdated", {
			_initiator: admin,
			_vestingRegistry: newVestingRegistry.address,
			_cliff: new BN(cliff + 1),
			_duration: new BN(duration + 1),
		});
	});

	it("Depositing Tokens using deposit() to own account should emit Deposited.", async () => {
		let value = randomValue() + 10;
		await sov.mint(userOne, value);
		await sov.approve(lockedSOV.address, value, { from: userOne });
		let basisPoint = randomValue();
		let txReceipt = await lockedSOV.deposit(userOne, value, basisPoint, { from: userOne });
		expectEvent(txReceipt, "Deposited", {
			_initiator: userOne,
			_userAddress: userOne,
			_sovAmount: new BN(value),
			_basisPoint: new BN(basisPoint),
		});
	});

	it("Depositing Tokens using deposit() to another account should emit Deposited.", async () => {
		let value = randomValue() + 10;
		await sov.mint(userOne, value);
		await sov.approve(lockedSOV.address, value, { from: userOne });
		let basisPoint = randomValue();
		let txReceipt = await lockedSOV.deposit(userTwo, value, basisPoint, { from: userOne });
		expectEvent(txReceipt, "Deposited", {
			_initiator: userOne,
			_userAddress: userTwo,
			_sovAmount: new BN(value),
			_basisPoint: new BN(basisPoint),
		});
	});

	it("Depositing Tokens using depositSOV() to own account should emit Deposited.", async () => {
		let value = randomValue() + 10;
		await sov.mint(userOne, value);
		await sov.approve(lockedSOV.address, value, { from: userOne });
		let txReceipt = await lockedSOV.depositSOV(userOne, value, { from: userOne });
		expectEvent(txReceipt, "Deposited", {
			_initiator: userOne,
			_userAddress: userOne,
			_sovAmount: new BN(value),
			_basisPoint: new BN(zero),
		});
	});

	it("Depositing Tokens using depositSOV() to another account should emit Deposited.", async () => {
		let value = randomValue() + 1;
		await sov.mint(userOne, value);
		await sov.approve(lockedSOV.address, value, { from: userOne });
		let txReceipt = await lockedSOV.depositSOV(userTwo, value, { from: userOne });
		expectEvent(txReceipt, "Deposited", {
			_initiator: userOne,
			_userAddress: userTwo,
			_sovAmount: new BN(value),
			_basisPoint: new BN(zero),
		});
	});

	it("Withdrawing unlocked Tokens to own account using withdraw() should emit Withdrawn.", async () => {
		let value = randomValue() + 10;
		await sov.mint(userOne, value);
		await sov.approve(lockedSOV.address, value, { from: userOne });
		let basisPoint = 5000; // 50% will be unlocked, rest will go to locked balance.
		await lockedSOV.deposit(userOne, value, basisPoint, { from: userOne });
		let txReceipt = await lockedSOV.withdraw(zeroAddress, { from: userOne });
		expectEvent(txReceipt, "Withdrawn", {
			_initiator: userOne,
			_userAddress: userOne,
			_sovAmount: new BN(Math.floor(value / 2)),
		});
	});

	it("Withdrawing unlocked Tokens to another account using withdraw() should emit Withdrawn.", async () => {
		let value = randomValue() + 10;
		await sov.mint(userOne, value);
		await sov.approve(lockedSOV.address, value, { from: userOne });
		let basisPoint = 5000; // 50% will be unlocked, rest will go to locked balance.
		await lockedSOV.deposit(userOne, value, basisPoint, { from: userOne });
		let txReceipt = await lockedSOV.withdraw(userTwo, { from: userOne });
		expectEvent(txReceipt, "Withdrawn", {
			_initiator: userOne,
			_userAddress: userTwo,
			_sovAmount: new BN(Math.floor(value / 2)),
		});
	});

	it("Using createVestingAndStake() should emit both VestingCreated and TokenStaked.", async () => {
		let value = randomValue() + 10;
		await sov.mint(userOne, value);
		await sov.approve(lockedSOV.address, value, { from: userOne });
		let basisPoint = 5000; // 50% will be unlocked, rest will go to locked balance.
		await lockedSOV.deposit(userOne, value, basisPoint, { from: userOne });
		let txReceipt = await lockedSOV.createVestingAndStake({ from: userOne });
		let vestingAddr = await vestingRegistry.getVesting(userOne);
		expectEvent(txReceipt, "VestingCreated", {
			_initiator: userOne,
			_userAddress: userOne,
			_vesting: vestingAddr,
		});
		expectEvent(txReceipt, "TokenStaked", {
			_initiator: userOne,
			_vesting: vestingAddr,
			_amount: new BN(Math.ceil(value / 2)),
		});
	});

	it("Using createVesting() should emit VestingCreated.", async () => {
		let txReceipt = await lockedSOV.createVesting({ from: userOne });
		let vestingAddr = await vestingRegistry.getVesting(userOne);
		expectEvent(txReceipt, "VestingCreated", {
			_initiator: userOne,
			_userAddress: userOne,
			_vesting: vestingAddr,
		});
	});

	it("Using stakeTokens() should emit TokenStaked.", async () => {
		let value = randomValue() + 10;
		await sov.mint(userOne, value);
		await sov.approve(lockedSOV.address, value, { from: userOne });
		let basisPoint = 5000; // 50% will be unlocked, rest will go to locked balance.
		await lockedSOV.deposit(userOne, value, basisPoint, { from: userOne });
		await lockedSOV.createVesting({ from: userOne });
		let vestingAddr = await vestingRegistry.getVesting(userOne);
		let txReceipt = await lockedSOV.stakeTokens({ from: userOne });
		expectEvent(txReceipt, "TokenStaked", {
			_initiator: userOne,
			_vesting: vestingAddr,
			_amount: new BN(Math.ceil(value / 2)),
		});
	});

	it("Using withdrawAndStakeTokens() should emit Withdrawn and TokenStaked.", async () => {
		let value = randomValue() + 10;
		await sov.mint(userOne, value);
		await sov.approve(lockedSOV.address, value, { from: userOne });
		let basisPoint = 5000; // 50% will be unlocked, rest will go to locked balance.
		await lockedSOV.deposit(userOne, value, basisPoint, { from: userOne });
		let vestingAddr = await vestingRegistry.getVesting(userOne);
		let txReceipt = await lockedSOV.withdrawAndStakeTokens(userOne, { from: userOne });
		expectEvent(txReceipt, "Withdrawn", {
			_initiator: userOne,
			_userAddress: userOne,
			_sovAmount: new BN(Math.floor(value / 2)),
		});
		expectEvent(txReceipt, "TokenStaked", {
			_initiator: userOne,
			_vesting: vestingAddr,
			_amount: new BN(Math.ceil(value / 2)),
		});
	});

	it("Using withdrawAndStakeTokensFrom() should emit Withdrawn and TokenStaked.", async () => {
		let value = randomValue() + 10;
		await sov.mint(userOne, value);
		await sov.approve(lockedSOV.address, value, { from: userOne });
		let basisPoint = 5000; // 50% will be unlocked, rest will go to locked balance.
		await lockedSOV.deposit(userOne, value, basisPoint, { from: userOne });
		let vestingAddr = await vestingRegistry.getVesting(userOne);
		let txReceipt = await lockedSOV.withdrawAndStakeTokensFrom(userOne, { from: userTwo });
		expectEvent(txReceipt, "Withdrawn", {
			_initiator: userOne,
			_userAddress: userOne,
			_sovAmount: new BN(Math.floor(value / 2)),
		});
		expectEvent(txReceipt, "TokenStaked", {
			_initiator: userOne,
			_vesting: vestingAddr,
			_amount: new BN(Math.ceil(value / 2)),
		});
	});

	it("Starting migration should emit MigrationStarted.", async () => {
		let txReceipt = await lockedSOV.startMigration(newLockedSOV.address, { from: admin });
		expectEvent(txReceipt, "MigrationStarted", {
			_initiator: admin,
			_newLockedSOV: newLockedSOV.address,
		});
	});

	it("Transfering locked balance using transfer() should emit UserTransfered.", async () => {
		let value = randomValue() + 10;
		await sov.mint(userOne, value);
		await sov.approve(lockedSOV.address, value, { from: userOne });
		let basisPoint = 5000; // 50% will be unlocked, rest will go to locked balance.
		await lockedSOV.deposit(userOne, value, basisPoint, { from: userOne });

		// Migratioin started by Admin
		await lockedSOV.startMigration(newLockedSOV.address, { from: admin });

		let txReceipt = await lockedSOV.transfer({ from: userOne });
		expectEvent(txReceipt, "UserTransfered", {
			_initiator: userOne,
			_amount: new BN(Math.ceil(value / 2)),
		});
	});
});
