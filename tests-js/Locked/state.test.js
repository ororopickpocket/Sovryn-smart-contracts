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
	constants, // Assertions for transactions that should fail.
} = require("@openzeppelin/test-helpers");

const { assert } = require("chai");

// Some constants we would be using in the contract.
let zero = new BN(0);
let zeroAddress = constants.ZERO_ADDRESS;
let cliff = 1; // This is in 4 weeks. i.e. 1 * 4 weeks.
let duration = 11; // This is in 4 weeks. i.e. 11 * 4 weeks.
let fourWeeks = 4 * 7 * 24 * 60 * 60;

/**
 * Function to create a random value.
 * It expects no parameter.
 *
 * @return {number} Random Value.
 */
function randomValue() {
	return Math.floor(Math.random() * 10000);
}

/**
 * Function to check the contract state.
 *
 * @param contractInstance The contract instance.
 * @param checkArray The items to be checked.
 * @param userAddr The user address for any particular check.
 * @param migration Whether the migration started or not, represented in bool.
 * @param cliff Wait period after which locked token starts unlocking, represented in 4 weeks duration. 2 means 8 weeks.
 * @param duration Duration of the entire staking, represented similar to cliff.
 * @param vestingRegistry The vesting registry address.
 * @param newLockedSOV The new locked sov address.
 * @param lockedBalance The locked balance of the `userAddr`.
 * @param unlockedBalance The unlocked balance of the `userAddr`.
 * @param isAdmin True if `userAddr` is an admin, false otherwise.
 */
async function checkStatus(
	contractInstance,
	checkArray,
	userAddr,
	migration,
	cliff,
	duration,
	vestingRegistry,
	newLockedSOV,
	lockedBalance,
	unlockedBalance,
	isAdmin
) {
	if (checkArray[0] == 1) {
		let cValue = await contractInstance.migration();
		assert.strictEqual(migration, cValue, "The migration status does not match.");
	}
	if (checkArray[1] == 1) {
		let cValue = await contractInstance.cliff();
		assert.strictEqual(cliff, cValue.toNumber() / fourWeeks, "The cliff does not match.");
	}
	if (checkArray[2] == 1) {
		let cValue = await contractInstance.duration();
		assert.strictEqual(duration, cValue.toNumber() / fourWeeks, "The duration does not match.");
	}
	if (checkArray[3] == 1) {
		let cValue = await contractInstance.vestingRegistry();
		assert.strictEqual(vestingRegistry, cValue, "The vesting registry does not match.");
	}
	if (checkArray[4] == 1) {
		let cValue = await contractInstance.newLockedSOV();
		assert.equal(newLockedSOV, cValue, "The new locked sov does not match.");
	}
	if (checkArray[5] == 1) {
		let cValue = await contractInstance.getLockedBalance(userAddr);
		assert.equal(lockedBalance, cValue.toNumber(), "The locked balance does not match.");
	}
	if (checkArray[6] == 1) {
		let cValue = await contractInstance.getUnlockedBalance(userAddr);
		assert.equal(unlockedBalance, cValue.toNumber(), "The unlocked balance does not match.");
	}
	if (checkArray[7] == 1) {
		let cValue = await contractInstance.adminStatus(userAddr);
		assert.equal(isAdmin, cValue, "The admin status does not match.");
	}
}

/**
 * Function to get the current token balance in contract & wallet.
 * It expects user address along with contract & token instances as parameters.
 *
 * @param addr The user/contract address.
 * @param sovContract The SOV Contract.
 * @param lockedSOVContract The Locked SOV Contract.
 *
 * @return [SOV Balance, Locked Balance, Unlocked Balance].
 */
async function getTokenBalances(addr, sovContract, lockedSOVContract) {
	let sovBal = await sovContract.balanceOf(addr);
	let lockedBal = await lockedSOVContract.getLockedBalance(addr);
	let unlockedBal = await lockedSOVContract.getUnlockedBalance(addr);
	return [sovBal, lockedBal, unlockedBal];
}

/**
 * Creates random token deposits from the user accounts.
 *
 * @param sovContract The SOV Contract.
 * @param lockedSOV The Locked SOV Contract.
 * @param sender User Address who is sending the deposit.
 * @param receiver User Address who will be receiving the deposit.
 * @param basisPoint The % in Basis Point to specify the amount to be unlocked immediately.
 *
 * @returns value The token amount which was deposited by user.
 */
async function userDeposits(sovContract, lockedSOVContract, sender, receiver, basisPoint) {
	let value = randomValue() + 10;
	await sovContract.mint(sender, value);
	await sovContract.approve(lockedSOVContract.address, value, { from: sender });
	await lockedSOVContract.deposit(receiver, value, basisPoint, { from: sender });
	return value;
}

contract("Locked SOV (State)", (accounts) => {
	let sov, lockedSOV, newLockedSOV, stakingLogic, staking, feeSharingProxy, vestingLogic, vestingFactory, vestingRegistry;
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

	it("Creating an instance should set all the values correctly.", async () => {
		await checkStatus(
			lockedSOV,
			[1, 1, 1, 1, 1, 1, 1, 1],
			userOne,
			false,
			cliff,
			duration,
			vestingRegistry.address,
			zeroAddress,
			zero,
			zero,
			false
		);
		await checkStatus(
			lockedSOV,
			[1, 1, 1, 1, 1, 1, 1, 1],
			admin,
			false,
			cliff,
			duration,
			vestingRegistry.address,
			zeroAddress,
			zero,
			zero,
			true
		);
	});

	it("Adding a new user as Admin should correctly reflect in contract.", async () => {
		await lockedSOV.addAdmin(newAdmin, { from: admin });
		await checkStatus(
			lockedSOV,
			[1, 1, 1, 1, 1, 1, 1, 1],
			newAdmin,
			false,
			cliff,
			duration,
			vestingRegistry.address,
			zeroAddress,
			zero,
			zero,
			true
		);
	});

	it("Removing a new user as Admin should correctly reflect in contract.", async () => {
		await lockedSOV.addAdmin(newAdmin, { from: admin });
		await checkStatus(
			lockedSOV,
			[1, 1, 1, 1, 1, 1, 1, 1],
			newAdmin,
			false,
			cliff,
			duration,
			vestingRegistry.address,
			zeroAddress,
			zero,
			zero,
			true
		);
		await lockedSOV.removeAdmin(newAdmin, { from: admin });
		await checkStatus(
			lockedSOV,
			[1, 1, 1, 1, 1, 1, 1, 1],
			newAdmin,
			false,
			cliff,
			duration,
			vestingRegistry.address,
			zeroAddress,
			zero,
			zero,
			false
		);
	});

	it("Updating the vestingRegistry, cliff and/or duration should correctly reflect in contract.", async () => {
		let newVestingRegistry = await VestingRegistry.new(
			vestingFactory.address,
			sov.address,
			staking.address,
			feeSharingProxy.address,
			creator // This should be Governance Timelock Contract.
		);
		await lockedSOV.changeRegistryCliffAndDuration(newVestingRegistry.address, cliff + 1, duration + 1, { from: admin });
		await checkStatus(
			lockedSOV,
			[1, 1, 1, 1, 1, 1, 1, 1],
			admin,
			false,
			cliff + 1,
			duration + 1,
			newVestingRegistry.address,
			zeroAddress,
			zero,
			zero,
			true
		);
	});

	it("Depositing Tokens using deposit() should update the user balances based on basis point.", async () => {
		let basisPoint = randomValue();
		let value = await userDeposits(sov, lockedSOV, userOne, userOne, basisPoint);
		let unlockedBal = Math.floor((value * basisPoint) / 10000);
		let lockedBal = value - unlockedBal;
		await checkStatus(
			lockedSOV,
			[1, 1, 1, 1, 1, 1, 1, 1],
			userOne,
			false,
			cliff,
			duration,
			vestingRegistry.address,
			zeroAddress,
			lockedBal,
			unlockedBal,
			false
		);
	});

	it("Depositing Tokens using depositSOV() should update the user locked balances.", async () => {
		let value = randomValue() + 1;
		await sov.mint(userOne, value);
		await sov.approve(lockedSOV.address, value, { from: userOne });
		await lockedSOV.depositSOV(userOne, value, { from: userOne });
		await checkStatus(
			lockedSOV,
			[1, 1, 1, 1, 1, 1, 1, 1],
			userOne,
			false,
			cliff,
			duration,
			vestingRegistry.address,
			zeroAddress,
			value,
			zero,
			false
		);
	});

	it("Withdrawing unlocked tokens themselves using withdraw() should update the unlocked balance and should not affect locked balance.", async () => {
		let basisPoint = 5000;
		let value = await userDeposits(sov, lockedSOV, userOne, userOne, basisPoint);
		let unlockedBal = Math.floor((value * basisPoint) / 10000);
		let lockedBal = value - unlockedBal;
		let beforeBal = await getTokenBalances(userOne, sov, lockedSOV);
		await lockedSOV.withdraw(zeroAddress, { from: userOne });
		let afterBal = await getTokenBalances(userOne, sov, lockedSOV);
		await checkStatus(
			lockedSOV,
			[1, 1, 1, 1, 1, 1, 1, 1],
			userOne,
			false,
			cliff,
			duration,
			vestingRegistry.address,
			zeroAddress,
			lockedBal,
			zero,
			false
		);
		assert.equal(afterBal[0].toNumber(), beforeBal[0].toNumber() + unlockedBal, "Correct amount was not withdrawn.");
	});

	it("Withdrawing unlocked tokens to someone else using withdraw() should update the token balance of that user.", async () => {
		let basisPoint = 5000;
		let value = await userDeposits(sov, lockedSOV, userOne, userOne, basisPoint);
		let unlockedBal = Math.floor((value * basisPoint) / 10000);
		let beforeBal = await getTokenBalances(userTwo, sov, lockedSOV);
		await lockedSOV.withdraw(userTwo, { from: userOne });
		let afterBal = await getTokenBalances(userTwo, sov, lockedSOV);
		assert.equal(afterBal[0].toNumber(), beforeBal[0].toNumber() + unlockedBal, "Correct amount was not withdrawn.");
	});

	it("Using createVestingAndStake() should create vesting address and stake tokens correctly.", async () => {
		let value = randomValue() + 10;
		await sov.mint(userThree, value);
		await sov.approve(lockedSOV.address, value, { from: userThree });
		let basisPoint = 5000; // 50% will be unlocked, rest will go to locked balance.
		await lockedSOV.deposit(userThree, value, basisPoint, { from: userThree });

		let vestingAddr = await vestingRegistry.getVesting(userThree);
		assert.equal(vestingAddr, zeroAddress, "Vesting Address should be zero.");

		await lockedSOV.createVestingAndStake({ from: userThree });

		vestingAddr = await vestingRegistry.getVesting(userThree);
		assert.notEqual(vestingAddr, zeroAddress, "Vesting Address should not be zero.");

		let balance = await staking.balanceOf(vestingAddr);
		let lockedValue = Math.ceil((value * basisPoint) / 10000);
		assert.equal(balance.toNumber(), Math.ceil(lockedValue), "Staking Balance does not match");

		let getStakes = await staking.getStakes(vestingAddr);
		assert.equal(getStakes.stakes[0].toNumber(), Math.ceil(lockedValue - Math.floor(lockedValue / duration) * (duration - 1)));
		for (let index = 1; index < getStakes.dates.length; index++) {
			assert.equal(getStakes.stakes[index].toNumber(), Math.floor(lockedValue / duration));
		}
	});

	it("Using createVesting() should create vesting address correctly.", async () => {
		let vestingAddr = await vestingRegistry.getVesting(userTwo);
		assert.equal(vestingAddr, zeroAddress, "Vesting Address should be zero.");
		await lockedSOV.createVesting({ from: userTwo });
		vestingAddr = await vestingRegistry.getVesting(userTwo);
		assert.notEqual(vestingAddr, zeroAddress, "Vesting Address should not be zero.");
	});

	it("Using stakeTokens() should correctly stake the locked tokens.", async () => {
		let value = randomValue() + 10;
		await sov.mint(userOne, value);
		await sov.approve(lockedSOV.address, value, { from: userOne });
		let basisPoint = 5000; // 50% will be unlocked, rest will go to locked balance.
		await lockedSOV.deposit(userOne, value, basisPoint, { from: userOne });

		await lockedSOV.createVesting({ from: userOne });
		await lockedSOV.stakeTokens({ from: userOne });

		vestingAddr = await vestingRegistry.getVesting(userOne);
		assert.notEqual(vestingAddr, zeroAddress, "Vesting Address should not be zero.");

		let balance = await staking.balanceOf(vestingAddr);
		let lockedValue = Math.ceil((value * basisPoint) / 10000);
		assert.equal(balance.toNumber(), Math.ceil(lockedValue), "Staking Balance does not match");

		let getStakes = await staking.getStakes(vestingAddr);
		assert.equal(getStakes.stakes[0].toNumber(), Math.ceil(lockedValue - Math.floor(lockedValue / duration) * (duration - 1)));
		for (let index = 1; index < getStakes.dates.length; index++) {
			assert.equal(getStakes.stakes[index].toNumber(), Math.floor(lockedValue / duration));
		}
	});

	// TODO from here
	it("Using withdrawAndStakeTokens() should correctly withdraw all unlocked tokens and stake locked tokens correctly.", async () => {
		let value = randomValue() + 10;
		await sov.mint(userTwo, value);
		await sov.approve(lockedSOV.address, value, { from: userTwo });
		let basisPoint = 5000; // 50% will be unlocked, rest will go to locked balance.
		await lockedSOV.deposit(userTwo, value, basisPoint, { from: userTwo });

		let unlockedBal = Math.floor((value * basisPoint) / 10000);
		let beforeBal = await getTokenBalances(userTwo, sov, lockedSOV);

		await lockedSOV.withdrawAndStakeTokens(userTwo, { from: userTwo });

		let afterBal = await getTokenBalances(userTwo, sov, lockedSOV);
		assert.equal(afterBal[0].toNumber(), beforeBal[0].toNumber() + unlockedBal, "Correct amount was not withdrawn.");

		vestingAddr = await vestingRegistry.getVesting(userTwo);
		assert.notEqual(vestingAddr, zeroAddress, "Vesting Address should not be zero.");

		let balance = await staking.balanceOf(vestingAddr);
		let lockedValue = Math.ceil((value * basisPoint) / 10000);
		assert.equal(balance.toNumber(), Math.ceil(lockedValue), "Staking Balance does not match");

		let getStakes = await staking.getStakes(vestingAddr);
		assert.equal(getStakes.stakes[0].toNumber(), Math.ceil(lockedValue - Math.floor(lockedValue / duration) * (duration - 1)));
		for (let index = 1; index < getStakes.dates.length; index++) {
			assert.equal(getStakes.stakes[index].toNumber(), Math.floor(lockedValue / duration));
		}
	});

	it("Using withdrawAndStakeTokensFrom() should correctly withdraw all unlocked tokens and stake locked tokens correctly.", async () => {
		let value = randomValue() + 10;
		await sov.mint(userFour, value);
		await sov.approve(lockedSOV.address, value, { from: userFour });
		let basisPoint = 5000; // 50% will be unlocked, rest will go to locked balance.
		await lockedSOV.deposit(userFour, value, basisPoint, { from: userFour });

		let unlockedBal = Math.floor((value * basisPoint) / 10000);
		let beforeBal = await getTokenBalances(userFour, sov, lockedSOV);

		await lockedSOV.withdrawAndStakeTokensFrom(userFour, { from: userOne });

		let afterBal = await getTokenBalances(userFour, sov, lockedSOV);
		assert.equal(afterBal[0].toNumber(), beforeBal[0].toNumber() + unlockedBal, "Correct amount was not withdrawn.");

		vestingAddr = await vestingRegistry.getVesting(userFour);
		assert.notEqual(vestingAddr, zeroAddress, "Vesting Address should not be zero.");

		let balance = await staking.balanceOf(vestingAddr);
		let lockedValue = Math.ceil((value * basisPoint) / 10000);
		assert.equal(balance.toNumber(), Math.ceil(lockedValue), "Staking Balance does not match");

		let getStakes = await staking.getStakes(vestingAddr);
		assert.equal(getStakes.stakes[0].toNumber(), Math.ceil(lockedValue - Math.floor(lockedValue / duration) * (duration - 1)));
		for (let index = 1; index < getStakes.dates.length; index++) {
			assert.equal(getStakes.stakes[index].toNumber(), Math.floor(lockedValue / duration));
		}
	});

	it("Starting the migration should update the contract status correctly.", async () => {
		await checkStatus(
			lockedSOV,
			[1, 1, 1, 1, 1, 1, 1, 1],
			userThree,
			false,
			cliff,
			duration,
			vestingRegistry.address,
			zeroAddress,
			zero,
			zero,
			false
		);
		await lockedSOV.startMigration(newLockedSOV.address, { from: admin });
		await checkStatus(
			lockedSOV,
			[1, 1, 1, 1, 1, 1, 1, 1],
			userThree,
			true,
			cliff,
			duration,
			vestingRegistry.address,
			newLockedSOV.address,
			zero,
			zero,
			false
		);
	});

	it("Using transfer() should correctly transfer locked token to new locked sov.", async () => {
		let value = randomValue() + 10;
		await sov.mint(userOne, value);
		await sov.approve(lockedSOV.address, value, { from: userOne });
		let basisPoint = 0;
		await lockedSOV.deposit(userOne, value, basisPoint, { from: userOne });

		// Migratioin started by Admin
		await lockedSOV.startMigration(newLockedSOV.address, { from: admin });

		await checkStatus(
			lockedSOV,
			[1, 1, 1, 1, 1, 1, 1, 1],
			userOne,
			true,
			cliff,
			duration,
			vestingRegistry.address,
			newLockedSOV.address,
			value,
			zero,
			false
		);
		await checkStatus(
			newLockedSOV,
			[1, 1, 1, 1, 1, 1, 1, 1],
			userOne,
			false,
			cliff,
			duration,
			vestingRegistry.address,
			zeroAddress,
			zero,
			zero,
			false
		);
		await lockedSOV.transfer({ from: userOne });
		await checkStatus(
			lockedSOV,
			[1, 1, 1, 1, 1, 1, 1, 1],
			userOne,
			true,
			cliff,
			duration,
			vestingRegistry.address,
			newLockedSOV.address,
			zero,
			zero,
			false
		);
		await checkStatus(
			newLockedSOV,
			[1, 1, 1, 1, 1, 1, 1, 1],
			userOne,
			false,
			cliff,
			duration,
			vestingRegistry.address,
			zeroAddress,
			value,
			zero,
			false
		);
	});
});
