const { expect } = require("chai");
const { BN } = require("@openzeppelin/test-helpers");

const SOV = artifacts.require("SOV");

const TOTAL_SUPPLY = "10000000000000000000000000";
const ZERO = new BN(0);

const NAME = "Sovryn Token";
const SYMBOL = "SOV";
const DECIMALS = 18;

contract("SOV:", (accounts) => {
	let root, account1, account2, account3;
	let tokenSOV, tokenSVR, staking;

	before(async () => {
		[root, account1, account2, account3, ...accounts] = accounts;
	});

	describe("constructor:", () => {
		it("sets the expected values", async () => {
			let tokenSOV = await SOV.new(TOTAL_SUPPLY);

			expect(await tokenSOV.name.call()).to.be.equal(NAME);
			expect(await tokenSOV.symbol.call()).to.be.equal(SYMBOL);
			expect(await tokenSOV.decimals.call()).to.be.bignumber.equal(new BN(DECIMALS));
		});

		it("does not mint tokens if initial amount is zero", async () => {
			let tokenSOV = await SOV.new(ZERO);
			let balance = await tokenSOV.balanceOf.call(tokenSOV.address);
			expect(balance.toNumber()).to.be.equal(0);
		});
	});

	describe("mint:", () => {
		it("should be able to mint SOV tokens", async () => {
			let amount = 1000;
			tokenSOV = await SOV.new(TOTAL_SUPPLY);
			let beforeBalance = await tokenSOV.balanceOf.call(account1);
			await tokenSOV.mint(account1, amount);
			let afterBalance = await tokenSOV.balanceOf.call(account1);
			expect(afterBalance.sub(beforeBalance).toNumber()).to.be.equal(amount);
		});
	});
});
