const { expect } = require("chai");
const { expectRevert, expectEvent, constants, BN, balance, time } = require("@openzeppelin/test-helpers");
const { encodeParameters, increaseTime, blockNumber, mineBlock } = require("../Utils/Ethereum");

const { ZERO_ADDRESS } = constants;
const EMPTY_ADDRESS = "";
const wei = web3.utils.toWei;

const MultiSigWallet = artifacts.require("MultiSigWallet");

contract("MultiSigWallet:", (accounts) => {
	let root, account1, account2, account3, account4, account5;
	let multiSig;
	let defaultData;

	before(async () => {
		[root, account1, account2, account3, account4, account5, ...accounts] = accounts;
	});

	beforeEach(async () => {
		multiSig = await MultiSigWallet.new([account1, account2, account3], 2);
	});

	describe("fallback", () => {
		it("Should allow to deposit ether", async () => {
			const tx = await multiSig.send(wei("0.0000000000000001", "ether"));
			expectEvent(tx, "Deposit", {
				sender: root,
				value: wei("0.0000000000000001", "ether"),
			});
		});
	});

	describe("constructor", () => {
		it("Shouldn't allow multisig for invalid requirement", async () => {
			await expectRevert.unspecified(MultiSigWallet.new([account1], 2));
		});

		it("Should allow creation of new multisig", async () => {
			multiSig = await MultiSigWallet.new([account1, account2, account3], 2);
			const ownerCount = await multiSig.getOwners();
			expect(ownerCount.length).to.be.equal(3);
			expect(ownerCount[0]).to.be.equal(account1);
			expect(ownerCount[1]).to.be.equal(account2);
			expect(ownerCount[2]).to.be.equal(account3);
			expect(await multiSig.required()).to.be.bignumber.equal(new BN(2));
		});
	});

	describe("addOwner", () => {
		it("should revert when submitting a transaction without wallet", async () => {
			await expectRevert.unspecified(multiSig.addOwner(account5, { from: account5 }));
			await expectRevert.unspecified(multiSig.addOwner(account5, { from: account1 }));
		});

		it("should revert when submitting a transaction with null destination", async () => {
			let multiSigInterface = new web3.eth.Contract(multiSig.abi, ZERO_ADDRESS);
			let data = multiSigInterface.methods.addOwner(ZERO_ADDRESS).encodeABI();
			await multiSig.submitTransaction(multiSig.address, 0, data, { from: account1 });
			let tx = await multiSig.confirmTransaction(0, { from: account2 });
			expectEvent(tx, "ExecutionFailure");
		});

		it("should revert when submitting a transaction with owner already exists", async () => {
			let multiSigInterface = new web3.eth.Contract(multiSig.abi, ZERO_ADDRESS);
			let data = multiSigInterface.methods.addOwner(account1).encodeABI();
			await multiSig.submitTransaction(multiSig.address, 0, data, { from: account1 });
			let tx = await multiSig.confirmTransaction(0, { from: account2 });
			expectEvent(tx, "ExecutionFailure");
		});

		it("Should allow to create a new owner for Multsig", async () => {
			let multiSigInterface = new web3.eth.Contract(multiSig.abi, ZERO_ADDRESS);
			let data = multiSigInterface.methods.addOwner(account4).encodeABI();
			//Submit Transaction
			await multiSig.submitTransaction(multiSig.address, 0, data, { from: account1 });
			//Confirm Transaction
			await multiSig.confirmTransaction(0, { from: account2 });
			const ownerCount = await multiSig.getOwners();
			expect(ownerCount.length).to.be.equal(4);
			expect(ownerCount[3]).to.be.equal(account4);
		});
	});

	describe("removeOwner", () => {
		it("should revert when submitting a transaction without wallet", async () => {
			await expectRevert.unspecified(multiSig.removeOwner(account5, { from: account5 }));
			await expectRevert.unspecified(multiSig.removeOwner(account5, { from: account1 }));
		});

		it("should fail when removing non-existing owner", async () => {
			let multiSigInterface = new web3.eth.Contract(multiSig.abi, ZERO_ADDRESS);
			let data = multiSigInterface.methods.removeOwner(account5).encodeABI();
			await multiSig.submitTransaction(multiSig.address, 0, data, { from: account1 });
			let tx = await multiSig.confirmTransaction(0, { from: account2 });
			expectEvent(tx, "ExecutionFailure");
		});

		it("Should remove a owner and change requirement for Multsig", async () => {
			multiSig = await MultiSigWallet.new([account1, account2], 2);
			let multiSigInterface = new web3.eth.Contract(multiSig.abi, ZERO_ADDRESS);
			let data = multiSigInterface.methods.removeOwner(account2).encodeABI();
			//Submit Transaction
			await multiSig.submitTransaction(multiSig.address, 0, data, { from: account1 });
			//Confirm Transaction
			let tx = await multiSig.confirmTransaction(0, { from: account2 });
			const ownerCount = await multiSig.getOwners();
			expect(ownerCount.length).to.be.equal(1);
			expectEvent(tx, "OwnerRemoval");
			expectEvent(tx, "RequirementChange");
		});

		it("Should allow to remove a owner for Multsig", async () => {
			let multiSigInterface = new web3.eth.Contract(multiSig.abi, ZERO_ADDRESS);
			let data = multiSigInterface.methods.removeOwner(account2).encodeABI();
			//Submit Transaction
			await multiSig.submitTransaction(multiSig.address, 0, data, { from: account1 });
			//Confirm Transaction
			let tx = await multiSig.confirmTransaction(0, { from: account2 });
			const ownerCount = await multiSig.getOwners();
			expect(ownerCount.length).to.be.equal(2);
			expectEvent(tx, "OwnerRemoval");
		});
	});

	describe("replaceOwner", () => {
		it("should revert when submitting a transaction without wallet", async () => {
			await expectRevert.unspecified(multiSig.replaceOwner(account2, account5, { from: account5 }));
			await expectRevert.unspecified(multiSig.replaceOwner(account2, account5, { from: account1 }));
		});

		it("should fail when replacing non-existing owner", async () => {
			let multiSigInterface = new web3.eth.Contract(multiSig.abi, ZERO_ADDRESS);
			let data = multiSigInterface.methods.replaceOwner(account5, account4).encodeABI();
			await multiSig.submitTransaction(multiSig.address, 0, data, { from: account1 });
			let tx = await multiSig.confirmTransaction(0, { from: account2 });
			expectEvent(tx, "ExecutionFailure");
		});

		it("Should allow to replacement of a owner for Multsig", async () => {
			let multiSigInterface = new web3.eth.Contract(multiSig.abi, ZERO_ADDRESS);
			let data = multiSigInterface.methods.replaceOwner(account3, account5).encodeABI();
			//Submit Transaction
			await multiSig.submitTransaction(multiSig.address, 0, data, { from: account1 });
			//Confirm Transaction
			let tx = await multiSig.confirmTransaction(0, { from: account2 });
			const ownerCount = await multiSig.getOwners();
			expect(ownerCount.length).to.be.equal(3);
			expectEvent(tx, "OwnerRemoval");
			expectEvent(tx, "OwnerAddition");
		});
	});

	describe("changeRequirement", () => {
		it("should revert when changing a requirement not from wallet itself", async () => {
			await expectRevert.unspecified(multiSig.changeRequirement(1, { from: account5 }));
			await expectRevert.unspecified(multiSig.changeRequirement(1, { from: account1 }));
		});

		it("should fail transaction when changing a requirement to zero", async () => {
			let multiSigInterface = new web3.eth.Contract(multiSig.abi, ZERO_ADDRESS);
			let data = multiSigInterface.methods.changeRequirement(0).encodeABI();
			await multiSig.submitTransaction(multiSig.address, 0, data, { from: account1 });
			let tx = await multiSig.confirmTransaction(0, { from: account2 });
			expectEvent(tx, "ExecutionFailure");
		});

		it("should fail transaction when changing a requirement to more than owners", async () => {
			let multiSigInterface = new web3.eth.Contract(multiSig.abi, ZERO_ADDRESS);
			let data = multiSigInterface.methods.changeRequirement(4).encodeABI();
			await multiSig.submitTransaction(multiSig.address, 0, data, { from: account1 });
			let tx = await multiSig.confirmTransaction(0, { from: account2 });
			expectEvent(tx, "ExecutionFailure");
		});

		it("should change transaction", async () => {
			let multiSigInterface = new web3.eth.Contract(multiSig.abi, ZERO_ADDRESS);
			let data = multiSigInterface.methods.changeRequirement(3).encodeABI();
			await multiSig.submitTransaction(multiSig.address, 0, data, { from: account1 });
			let tx = await multiSig.confirmTransaction(0, { from: account2 });
			const ownerCount = await multiSig.getOwners();
			expect(ownerCount.length).to.be.equal(3);
			expectEvent(tx, "Confirmation");
			expectEvent(tx, "RequirementChange");
			expectEvent(tx, "Execution");
		});
	});

	describe("revokeConfirmation", () => {
		it("should revert when revoking confirmation from unauthorized caller", async () => {
			defaultDataSet();
			await multiSig.submitTransaction(multiSig.address, 0, defaultData, { from: account1 });
			await expectRevert.unspecified(multiSig.revokeConfirmation(0, { from: account5 }));
		});

		it("should revert when revoking unconfirmed transaction", async () => {
			await expectRevert.unspecified(multiSig.revokeConfirmation(0, { from: account1 }));
		});

		it("should revert when revoking confirmation for already executed transaction", async () => {
			defaultDataSet();
			await multiSig.submitTransaction(multiSig.address, 0, defaultData, { from: account1 });
			await multiSig.confirmTransaction(0, { from: account2 });
			await expectRevert.unspecified(multiSig.revokeConfirmation(0, { from: account3 }));
		});

		it("should revoke confirmation using correct data", async () => {
			defaultDataSet();
			await multiSig.submitTransaction(multiSig.address, 0, defaultData, { from: account1 });
			let tx = await multiSig.revokeConfirmation(0, { from: account1 });
			expectEvent(tx, "Revocation");
		});
	});

	describe("executeTransaction", () => {
		it("should fail transaction execution for non-owners", async () => {
			await expectRevert.unspecified(multiSig.executeTransaction(0, { from: account5 }));
		});

		it("should revert when executing unconfirmed transaction", async () => {
			await expectRevert.unspecified(multiSig.executeTransaction(0, { from: account1 }));
		});

		it("should revert when executing confirmation for already executed transaction", async () => {
			defaultDataSet();
			await multiSig.submitTransaction(multiSig.address, 0, defaultData, { from: account1 });
			await multiSig.confirmTransaction(0, { from: account2 });
			await expectRevert.unspecified(multiSig.executeTransaction(0, { from: account3 }));
		});

		it("should execute transaction using correct data", async () => {
			defaultDataSet();
			await multiSig.submitTransaction(multiSig.address, 0, defaultData, { from: account1 });
			await multiSig.revokeConfirmation(0, { from: account1 });
			await multiSig.confirmTransaction(0, { from: account2 });
			let tx = await multiSig.confirmTransaction(0, { from: account3 });
			expectEvent(tx, "Execution");
		});
	});

	describe("getters", () => {
		it("should get confirmation count", async () => {
			defaultDataSet();
			await multiSig.submitTransaction(multiSig.address, 0, defaultData, { from: account1 });
			expect(await multiSig.getConfirmationCount(0)).to.be.bignumber.equal(new BN(1));
		});

		it("should get transaction count", async () => {
			defaultDataSet();
			await multiSig.submitTransaction(multiSig.address, 0, defaultData, { from: account1 });
			expect(await multiSig.getTransactionCount(true, true)).to.be.bignumber.equal(new BN(1));
		});

		it("should get the owner address for confirmed transactions", async () => {
			defaultDataSet();
			await multiSig.submitTransaction(multiSig.address, 0, defaultData, { from: account1 });
			await multiSig.confirmTransaction(0, { from: account2 });
			let result = await multiSig.getConfirmations(0);
			expect(result.length).to.be.equal(2);
			expect(result[0]).to.be.equal(account1);
			expect(result[1]).to.be.equal(account2);
		});

		it("should get the list of transaction IDs in defined range", async () => {
			defaultDataSet();
			await multiSig.submitTransaction(multiSig.address, 0, defaultData, { from: account1 });
			await multiSig.confirmTransaction(0, { from: account2 });
			let multiSigInterface = new web3.eth.Contract(multiSig.abi, ZERO_ADDRESS);
			let data = multiSigInterface.methods.replaceOwner(account3, account4).encodeABI();
			await multiSig.submitTransaction(multiSig.address, 0, data, { from: account2 });
			await multiSig.confirmTransaction(1, { from: account3 });
			let result = await multiSig.getTransactionIds(0, 2, true, true);
			expect(result.length).to.be.equal(2);
			expect(result[0]).to.be.bignumber.equal(new BN(0));
			expect(result[1]).to.be.bignumber.equal(new BN(1));
		});
	});

	function defaultDataSet() {
		let multiSigInterface = new web3.eth.Contract(multiSig.abi, ZERO_ADDRESS);
		defaultData = multiSigInterface.methods.addOwner(account5).encodeABI();
	}
});
