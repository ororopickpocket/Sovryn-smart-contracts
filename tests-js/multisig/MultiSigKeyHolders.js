const { expect } = require("chai");
const { expectRevert, expectEvent, constants, BN, balance, time } = require("@openzeppelin/test-helpers");

const { ZERO_ADDRESS } = constants;
const EMPTY_ADDRESS = "";

const MultiSigKeyHolders = artifacts.require("MultiSigKeyHolders");

contract("MultiSigKeyHolders:", (accounts) => {
	let root, account1, account2, account3, account4;
	let multiSig;
	let bitcoinAccount1 = "bc1q9gl8ddnkr0xr5d9vefnkwyd3g8fpjsp8z8l7zm";
	let bitcoinAccount2 = "37S6qsjzw14MH9SFt7PmsBchobkRE6SxNP";
	let bitcoinAccount3 = "37S6qsjzw14MH9SFt7PmsBchobkRE6SxN3";

	before(async () => {
		[root, account1, account2, account3, account4, ...accounts] = accounts;
	});

	beforeEach(async () => {
		multiSig = await MultiSigKeyHolders.new();
	});

	describe("initialization", () => {
		it("Should set default values", async () => {
			expect(await multiSig.ethereumRequired.call()).to.be.bignumber.equal(new BN(2));
			expect(await multiSig.bitcoinRequired.call()).to.be.bignumber.equal(new BN(2));
		});
	});

	describe("addEthereumAddress", () => {
		it("Shouldn't be able to add zero address", async () => {
			await expectRevert(multiSig.addEthereumAddress(ZERO_ADDRESS), "Invalid address");
		});

		it("Only owner should be able to add address", async () => {
			await expectRevert(multiSig.addEthereumAddress(account1, { from: account1 }), "unauthorized");
		});

		it("Should be able to add address", async () => {
			let tx = await multiSig.addEthereumAddress(account1);

			let isOwner = await multiSig.isEthereumAddressOwner.call(account1);
			expect(isOwner).to.be.true;

			let list = await multiSig.getEthereumAddresses.call();
			expect(list.length).to.be.equal(1);
			expect(list[0]).to.be.equal(account1);

			expectEvent(tx, "EthereumAddressAdded", {
				account: account1,
			});
		});
	});

	describe("addEthereumAddresses", () => {
		it("Shouldn't be able to add zero addresses", async () => {
			await expectRevert(multiSig.addEthereumAddresses([ZERO_ADDRESS]), "Invalid address");
		});

		it("Only owner should be able to add addresses", async () => {
			await expectRevert(multiSig.addEthereumAddresses([account1, account2], { from: account1 }), "unauthorized");
		});

		it("Should be able to add addresses", async () => {
			let tx = await multiSig.addEthereumAddresses([account1, account2]);

			let isOwner = await multiSig.isEthereumAddressOwner.call(account1);
			expect(isOwner).to.be.true;
			isOwner = await multiSig.isEthereumAddressOwner.call(account2);
			expect(isOwner).to.be.true;

			let list = await multiSig.getEthereumAddresses.call();
			expect(list.length).to.be.equal(2);
			expect(list[0]).to.be.equal(account1);
			expect(list[1]).to.be.equal(account2);

			expectEvent(tx, "EthereumAddressAdded", {
				account: account1,
			});
			expectEvent(tx, "EthereumAddressAdded", {
				account: account2,
			});
		});
	});

	describe("changeEthereumRequirement", () => {
		it("Only owner should be able to change ethereum requirement", async () => {
			await expectRevert(multiSig.changeEthereumRequirement(1, { from: account1 }), "unauthorized");
		});

		it("Only owner should be able to change ethereum requirement", async () => {
			await expectRevert(multiSig.changeEthereumRequirement(5), "Invalid required");
		});

		it("Should be able to change ethereum requirement", async () => {
			let required = 3;
			await multiSig.addEthereumAddresses([account1, account2, account3]);

			let tx = await multiSig.changeEthereumRequirement(required);

			expect(await multiSig.ethereumRequired.call()).to.be.bignumber.equal(new BN(required));

			expectEvent(tx, "EthereumRequirementChanged", {
				required: new BN(required),
			});
		});
	});

	describe("addBitcoinAddress", () => {
		it("Shouldn't be able to add zero address", async () => {
			await expectRevert(multiSig.addBitcoinAddress(EMPTY_ADDRESS), "Invalid address");
		});

		it("Only owner should be able to add address", async () => {
			await expectRevert(multiSig.addBitcoinAddress(bitcoinAccount1, { from: account1 }), "unauthorized");
		});

		it("Should be able to add address", async () => {
			let tx = await multiSig.addBitcoinAddress(bitcoinAccount1);

			let isOwner = await multiSig.isBitcoinAddressOwner.call(bitcoinAccount1);
			expect(isOwner).to.be.true;

			let list = await multiSig.getBitcoinAddresses.call();
			expect(list.length).to.be.equal(1);
			expect(list[0]).to.be.equal(bitcoinAccount1);

			expectEvent(tx, "BitcoinAddressAdded", {
				account: bitcoinAccount1,
			});
		});
	});

	describe("addBitcoinAddresses", () => {
		it("Shouldn't be able to add zero addresses", async () => {
			await expectRevert(multiSig.addBitcoinAddresses([EMPTY_ADDRESS]), "Invalid address");
		});

		it("Only owner should be able to add addresses", async () => {
			await expectRevert(multiSig.addBitcoinAddresses([bitcoinAccount1, bitcoinAccount2], { from: account1 }), "unauthorized");
		});

		it("Should be able to add addresses", async () => {
			let tx = await multiSig.addBitcoinAddresses([bitcoinAccount1, bitcoinAccount2]);

			let isOwner = await multiSig.isBitcoinAddressOwner.call(bitcoinAccount1);
			expect(isOwner).to.be.true;
			isOwner = await multiSig.isBitcoinAddressOwner.call(bitcoinAccount2);
			expect(isOwner).to.be.true;

			let list = await multiSig.getBitcoinAddresses.call();
			expect(list.length).to.be.equal(2);
			expect(list[0]).to.be.equal(bitcoinAccount1);
			expect(list[1]).to.be.equal(bitcoinAccount2);

			expectEvent(tx, "BitcoinAddressAdded", {
				account: bitcoinAccount1,
			});
			expectEvent(tx, "BitcoinAddressAdded", {
				account: bitcoinAccount2,
			});
		});
	});

	describe("addEthereumAndBitcoinAddresses", () => {
		it("Shouldn't be able to add zero address", async () => {
			await expectRevert(multiSig.addEthereumAndBitcoinAddresses([ZERO_ADDRESS], [bitcoinAccount1]), "Invalid address");
		});

		it("Only owner should be able to add address", async () => {
			await expectRevert(
				multiSig.addEthereumAndBitcoinAddresses([account1, account2], [bitcoinAccount1, bitcoinAccount2], { from: account1 }),
				"unauthorized"
			);
		});

		it("Should be able to add addresses", async () => {
			let tx = await multiSig.addEthereumAndBitcoinAddresses([account1, account2], [bitcoinAccount1, bitcoinAccount2]);

			let isOwner = await multiSig.isEthereumAddressOwner.call(account1);
			expect(isOwner).to.be.true;
			isOwner = await multiSig.isEthereumAddressOwner.call(account2);
			expect(isOwner).to.be.true;

			let list = await multiSig.getEthereumAddresses.call();
			expect(list.length).to.be.equal(2);
			expect(list[0]).to.be.equal(account1);
			expect(list[1]).to.be.equal(account2);

			expectEvent(tx, "EthereumAddressAdded", {
				account: account1,
			});
			expectEvent(tx, "EthereumAddressAdded", {
				account: account2,
			});

			isOwner = await multiSig.isBitcoinAddressOwner.call(bitcoinAccount1);
			expect(isOwner).to.be.true;
			isOwner = await multiSig.isBitcoinAddressOwner.call(bitcoinAccount2);
			expect(isOwner).to.be.true;

			list = await multiSig.getBitcoinAddresses.call();
			expect(list.length).to.be.equal(2);
			expect(list[0]).to.be.equal(bitcoinAccount1);
			expect(list[1]).to.be.equal(bitcoinAccount2);

			expectEvent(tx, "BitcoinAddressAdded", {
				account: bitcoinAccount1,
			});
			expectEvent(tx, "BitcoinAddressAdded", {
				account: bitcoinAccount2,
			});
		});
	});

	describe("removeEthereumAddress", () => {
		it("Shouldn't be able to remove zero address", async () => {
			await expectRevert(multiSig.removeEthereumAddress(ZERO_ADDRESS), "Invalid address");
		});

		it("Only owner should be able to remove address", async () => {
			await expectRevert(multiSig.removeEthereumAddress(account1, { from: account1 }), "unauthorized");
		});

		it("Should be able to remove address", async () => {
			await multiSig.addEthereumAddress(account1);
			let tx = await multiSig.removeEthereumAddress(account1);

			let isOwner = await multiSig.isEthereumAddressOwner.call(account1);
			expect(isOwner).to.be.false;

			let list = await multiSig.getEthereumAddresses.call();
			expect(list.length).to.be.equal(0);

			expectEvent(tx, "EthereumAddressRemoved", {
				account: account1,
			});
		});
	});

	describe("removeEthereumAddresses", () => {
		it("Shouldn't be able to remove zero addresses", async () => {
			await expectRevert(multiSig.removeEthereumAddresses([ZERO_ADDRESS]), "Invalid address");
		});

		it("Only owner should be remove to add addresses", async () => {
			await expectRevert(multiSig.removeEthereumAddresses([account1, account2], { from: account1 }), "unauthorized");
		});

		it("Should be able to remove addresses", async () => {
			await multiSig.addEthereumAddresses([account1, account2]);
			let tx = await multiSig.removeEthereumAddresses([account1, account2]);

			let isOwner = await multiSig.isEthereumAddressOwner.call(account1);
			expect(isOwner).to.be.false;
			isOwner = await multiSig.isEthereumAddressOwner.call(account2);
			expect(isOwner).to.be.false;

			let list = await multiSig.getEthereumAddresses.call();
			expect(list.length).to.be.equal(0);

			expectEvent(tx, "EthereumAddressRemoved", {
				account: account1,
			});
			expectEvent(tx, "EthereumAddressRemoved", {
				account: account2,
			});
		});
	});

	describe("removeBitcoinAddress", () => {
		it("Shouldn't be able to remove zero address", async () => {
			await expectRevert(multiSig.removeBitcoinAddress(EMPTY_ADDRESS), "Invalid address");
		});

		it("Only owner should be remove to add address", async () => {
			await expectRevert(multiSig.removeBitcoinAddress(bitcoinAccount1, { from: account1 }), "unauthorized");
		});

		it("Should be able to remove address", async () => {
			await multiSig.addBitcoinAddress(bitcoinAccount1);
			let tx = await multiSig.removeBitcoinAddress(bitcoinAccount1);

			let isOwner = await multiSig.isBitcoinAddressOwner.call(bitcoinAccount1);
			expect(isOwner).to.be.false;

			let list = await multiSig.getBitcoinAddresses.call();
			expect(list.length).to.be.equal(0);

			expectEvent(tx, "BitcoinAddressRemoved", {
				account: bitcoinAccount1,
			});
		});
	});

	describe("removeBitcoinAddresses", () => {
		it("Shouldn't be able to remove zero addresses", async () => {
			await expectRevert(multiSig.removeBitcoinAddresses([EMPTY_ADDRESS]), "Invalid address");
		});

		it("Only owner should be able to remove addresses", async () => {
			await expectRevert(multiSig.removeBitcoinAddresses([bitcoinAccount1, bitcoinAccount2], { from: account1 }), "unauthorized");
		});

		it("Should be able to remove addresses", async () => {
			await multiSig.addBitcoinAddresses([bitcoinAccount1, bitcoinAccount2]);
			let tx = await multiSig.removeBitcoinAddresses([bitcoinAccount1, bitcoinAccount2]);

			let isOwner = await multiSig.isBitcoinAddressOwner.call(bitcoinAccount1);
			expect(isOwner).to.be.false;
			isOwner = await multiSig.isBitcoinAddressOwner.call(bitcoinAccount2);
			expect(isOwner).to.be.false;

			let list = await multiSig.getBitcoinAddresses.call();
			expect(list.length).to.be.equal(0);

			expectEvent(tx, "BitcoinAddressRemoved", {
				account: bitcoinAccount1,
			});
			expectEvent(tx, "BitcoinAddressRemoved", {
				account: bitcoinAccount2,
			});
		});
	});

	describe("removeEthereumAndBitcoinAddresses", () => {
		it("Shouldn't be able to remove zero address", async () => {
			await expectRevert(multiSig.removeEthereumAndBitcoinAddresses([ZERO_ADDRESS], [bitcoinAccount1]), "Invalid address");
		});

		it("Only owner should be able to remove address", async () => {
			await expectRevert(
				multiSig.removeEthereumAndBitcoinAddresses([account1, account2], [bitcoinAccount1, bitcoinAccount2], { from: account1 }),
				"unauthorized"
			);
		});

		it("Should be able to remove addresses", async () => {
			await multiSig.addEthereumAndBitcoinAddresses([account1, account2], [bitcoinAccount1, bitcoinAccount2]);
			let tx = await multiSig.removeEthereumAndBitcoinAddresses([account1, account2], [bitcoinAccount1, bitcoinAccount2]);

			let isOwner = await multiSig.isEthereumAddressOwner.call(account1);
			expect(isOwner).to.be.false;
			isOwner = await multiSig.isEthereumAddressOwner.call(account2);
			expect(isOwner).to.be.false;

			let list = await multiSig.getEthereumAddresses.call();
			expect(list.length).to.be.equal(0);

			expectEvent(tx, "EthereumAddressRemoved", {
				account: account1,
			});
			expectEvent(tx, "EthereumAddressRemoved", {
				account: account2,
			});

			isOwner = await multiSig.isBitcoinAddressOwner.call(bitcoinAccount1);
			expect(isOwner).to.be.false;
			isOwner = await multiSig.isBitcoinAddressOwner.call(bitcoinAccount2);
			expect(isOwner).to.be.false;

			list = await multiSig.getBitcoinAddresses.call();
			expect(list.length).to.be.equal(0);

			expectEvent(tx, "BitcoinAddressRemoved", {
				account: bitcoinAccount1,
			});
			expectEvent(tx, "BitcoinAddressRemoved", {
				account: bitcoinAccount2,
			});
		});
	});

	describe("changeBitcoinRequirement", () => {
		it("Only owner should be able to change ethereum requirement", async () => {
			await expectRevert(multiSig.changeBitcoinRequirement(1, { from: account1 }), "unauthorized");
		});

		it("Only owner should be able to change ethereum requirement", async () => {
			await expectRevert(multiSig.changeBitcoinRequirement(5), "Invalid required");
		});

		it("Should be able to change ethereum requirement", async () => {
			let required = 3;
			await multiSig.addBitcoinAddresses([bitcoinAccount1, bitcoinAccount2, bitcoinAccount3]);

			let tx = await multiSig.changeBitcoinRequirement(required);

			expect(await multiSig.bitcoinRequired.call()).to.be.bignumber.equal(new BN(required));

			expectEvent(tx, "BitcoinRequirementChanged", {
				required: new BN(required),
			});
		});
	});
});
