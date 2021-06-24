// For this test, multisig wallet will be done by normal wallets.

const EscrowReward = artifacts.require("EscrowReward");
const LockedSOV = artifacts.require("LockedSOV"); // Ideally should be using actual LockedSOV for testing.
const SOV = artifacts.require("TestToken");
const VestingLogic = artifacts.require("VestingLogic");
const VestingFactory = artifacts.require("VestingFactory");
const VestingRegistry = artifacts.require("VestingRegistry3");
const StakingLogic = artifacts.require("Staking");
const StakingProxy = artifacts.require("StakingProxy");
const FeeSharingProxy = artifacts.require("FeeSharingProxyMockup");

const {
	BN, // Big Number support.
	expectEvent,
	constants, // Assertions for transactions that should fail.
} = require("@openzeppelin/test-helpers");

const { assert } = require("chai");

// Some constants we would be using in the contract.
let zero = new BN(0);
let cliff = 1; // This is in 4 weeks. i.e. 1 * 4 weeks.
let duration = 11; // This is in 4 weeks. i.e. 11 * 4 weeks.
const depositLimit = 75000000;

/**
 * Function to create a random value.
 * It expects no parameter.
 *
 * @return {number} Random Value.
 */
function randomValue() {
	return Math.floor(Math.random() * 1000000);
}

/**
 * Function to get the current timestamp.
 * It expects no parameter.
 *
 *  @return {number} Current Timestamp.
 */
function currentTimestamp() {
	return Math.floor(Date.now() / 1000);
}

contract("Escrow Rewards (Events)", (accounts) => {
	let escrowReward, sov, lockedSOV;
	let creator, multisig, newMultisig, safeVault, userOne, userTwo, userThree, userFour, userFive;

	before("Initiating Accounts & Creating Test Token Instance.", async () => {
		// Checking if we have enough accounts to test.
		assert.isAtLeast(accounts.length, 9, "Alteast 9 accounts are required to test the contracts.");
		[creator, multisig, newMultisig, safeVault, userOne, userTwo, userThree, userFour, userFive] = accounts;

		// Creating the instance of SOV Token.
		sov = await SOV.new("Sovryn", "SOV", 18, zero);

		// Creating the Staking Instance.
		stakingLogic = await StakingLogic.new(sov.address);
		staking = await StakingProxy.new(sov.address);
		await staking.setImplementation(stakingLogic.address);
		staking = await StakingLogic.at(staking.address);

		// Creating the FeeSharing Instance.
		feeSharingProxy = await FeeSharingProxy.new(constants.ZERO_ADDRESS, staking.address);

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
		lockedSOV = await LockedSOV.new(sov.address, vestingRegistry.address, cliff, duration, [multisig]);
	});

	beforeEach("Creating New Escrow Contract Instance.", async () => {
		// Creating the contract instance.
		escrowReward = await EscrowReward.new(lockedSOV.address, sov.address, multisig, zero, depositLimit, { from: creator });

		// Marking the contract as active.
		await escrowReward.init({ from: multisig });

		// Adding the contract as an admin in the lockedSOV.
		await lockedSOV.addAdmin(escrowReward.address, { from: multisig });
	});

	it("Calling the init() will emit EscrowActivated Event.", async () => {
		// Creating the contract instance.
		escrowReward = await EscrowReward.new(lockedSOV.address, sov.address, multisig, zero, depositLimit, { from: creator });
		let txReceipt = await escrowReward.init({ from: multisig });
		expectEvent(txReceipt, "EscrowActivated");
	});

	it("Updating the Multisig should emit NewMultisig Event.", async () => {
		let txReceipt = await escrowReward.updateMultisig(newMultisig, { from: multisig });
		expectEvent(txReceipt, "NewMultisig", {
			_initiator: multisig,
			_newMultisig: newMultisig,
		});
	});

	it("Updating the release time should emit TokenReleaseUpdated Event.", async () => {
		let timestamp = currentTimestamp();
		let txReceipt = await escrowReward.updateReleaseTimestamp(timestamp, { from: multisig });
		expectEvent(txReceipt, "TokenReleaseUpdated", {
			_initiator: multisig,
			_releaseTimestamp: new BN(timestamp),
		});
	});

	it("Updating the deposit limit should emit TokenDepositLimitUpdated Event.", async () => {
		let txReceipt = await escrowReward.updateDepositLimit(zero, { from: multisig });
		expectEvent(txReceipt, "TokenDepositLimitUpdated", {
			_initiator: multisig,
			_depositLimit: new BN(zero),
		});
	});

	it("Depositing Tokens by Users should emit TokenDeposit Event.", async () => {
		let value = randomValue() + 1;
		await sov.mint(userOne, value);
		await sov.approve(escrowReward.address, value, { from: userOne });
		let txReceipt = await escrowReward.depositTokens(value, { from: userOne });
		expectEvent(txReceipt, "TokenDeposit", {
			_initiator: userOne,
			_amount: new BN(value),
		});
	});

	it("Reaching the Deposit Limit should emit TokenDeposit Event.", async () => {
		let value = randomValue() + 1;

		await escrowReward.updateDepositLimit(value, { from: multisig });

		await sov.mint(userOne, value);
		await sov.approve(escrowReward.address, value, { from: userOne });

		let txReceipt = await escrowReward.depositTokens(value, { from: userOne });
		expectEvent(txReceipt, "DepositLimitReached");
	});

	it("Changing the contract to Holding State should emit EscrowInHoldingState Event.", async () => {
		let txReceipt = await escrowReward.changeStateToHolding({ from: multisig });
		expectEvent(txReceipt, "EscrowInHoldingState");
	});

	it("Multisig token withdraw should emit TokenWithdrawByMultisig Event.", async () => {
		await escrowReward.changeStateToHolding({ from: multisig });

		let beforeSafeVaultSOVBalance = await sov.balanceOf(safeVault);
		let txReceipt = await escrowReward.withdrawTokensByMultisig(safeVault, { from: multisig });
		let afterSafeVaultSOVBalance = await sov.balanceOf(safeVault);
		expectEvent(txReceipt, "TokenWithdrawByMultisig", {
			_initiator: multisig,
			_amount: new BN(afterSafeVaultSOVBalance - beforeSafeVaultSOVBalance),
		});
	});

	it("Multisig token deposit should emit TokenDepositByMultisig Event.", async () => {
		let value = randomValue() + 1;
		await sov.mint(userOne, value);
		await sov.approve(escrowReward.address, value, { from: userOne });
		await escrowReward.depositTokens(value, { from: userOne });

		await escrowReward.changeStateToHolding({ from: multisig });

		await escrowReward.withdrawTokensByMultisig(safeVault, { from: multisig });

		await sov.mint(multisig, value);
		await sov.approve(escrowReward.address, value, { from: multisig });
		let txReceipt = await escrowReward.depositTokensByMultisig(value, { from: multisig });
		expectEvent(txReceipt, "TokenDepositByMultisig", {
			_initiator: multisig,
			_amount: new BN(value),
		});
	});

	it("Updating the Locked SOV Contract Address should emit LockedSOVUpdated Event.", async () => {
		let newLockedSOV = await LockedSOV.new(sov.address, vestingRegistry.address, cliff, duration, [multisig]);
		let txReceipt = await escrowReward.updateLockedSOV(newLockedSOV.address, { from: multisig });
		expectEvent(txReceipt, "LockedSOVUpdated", {
			_initiator: multisig,
			_lockedSOV: newLockedSOV.address,
		});
	});

	it("Multisig reward token deposit should emit RewardDepositsByMultisig Event.", async () => {
		let reward = randomValue() + 1;
		await sov.mint(multisig, reward);
		await sov.approve(escrowReward.address, reward, { from: multisig });
		let txReceipt = await escrowReward.depositRewardByMultisig(reward, { from: multisig });
		expectEvent(txReceipt, "RewardDepositByMultisig", {
			_initiator: multisig,
			_amount: new BN(reward),
		});
	});

	it("SOV and Reward withdraw should emit TokenWithdraw and RewardTokenWithdraw Events", async () => {
		let value = randomValue() + 100;
		let reward = Math.ceil(value / 100);
		await sov.mint(userOne, value);
		await sov.approve(escrowReward.address, value, { from: userOne });
		await escrowReward.depositTokens(value, { from: userOne });
		await escrowReward.updateReleaseTimestamp(currentTimestamp(), { from: multisig });
		await escrowReward.changeStateToHolding({ from: multisig });
		await escrowReward.withdrawTokensByMultisig(constants.ZERO_ADDRESS, { from: multisig });
		await sov.mint(multisig, reward);
		await sov.approve(escrowReward.address, reward, { from: multisig });
		await escrowReward.depositRewardByMultisig(reward, { from: multisig });
		await sov.approve(escrowReward.address, value, { from: multisig });
		await escrowReward.depositTokensByMultisig(value, { from: multisig });

		let txReceipt = await escrowReward.withdrawTokensAndReward({ from: userOne });
		expectEvent(txReceipt, "TokenWithdraw", {
			_initiator: userOne,
			_amount: new BN(value),
		});
		expectEvent(txReceipt, "RewardTokenWithdraw", {
			_initiator: userOne,
			_amount: new BN(reward),
		});
	});
});
