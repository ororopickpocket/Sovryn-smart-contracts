const { expect } = require("chai");
const { constants } = require("@openzeppelin/test-helpers");

const TestLibraries = artifacts.require("TestLibraries");
const PUB_KEY_FROM_ZERO = "0xdcc703c0E500B653Ca82273B7BFAd8045D85a470";

contract("TestLibraries", (accounts) => {
	let account1, account2;
	let testLibraries, rskAddressValidator;

	before(async () => {
		[admin, account1, account2] = accounts;
		testLibraries = await TestLibraries.new();
	});
	describe("test RSKAddrValidator", async () => {
		it("checkPKNotZero(PUB_KEY_FROM_ZERO_ADDRESS) == false", async () => {
			//key derived from zero private address
			expect(await testLibraries.RSKAddrValidator_checkPKNotZero(PUB_KEY_FROM_ZERO)).to.be.false;
		});
		it("checkPKNotZero(ZERO_ADDRESS) == true", async () => {
			expect(await testLibraries.RSKAddrValidator_checkPKNotZero(constants.ZERO_ADDRESS)).to.be.false;
		});
		it("checkPKNotZero(valid_address) == true", async () => {
			expect(await testLibraries.RSKAddrValidator_checkPKNotZero(account1)).to.be.true;
		});

		it("safeEquals(account1, account1) == true", async () => {
			expect(await testLibraries.RSKAddrValidator_safeEquals(account1, account1)).to.be.true;
		});
		it("safeEquals(PUB_KEY_FROM_ZERO, PUB_KEY_FROM_ZERO) == false", async () => {
			expect(await testLibraries.RSKAddrValidator_safeEquals(PUB_KEY_FROM_ZERO, PUB_KEY_FROM_ZERO)).to.be.false;
		});
		it("safeEquals(ZERO_ADDRESS, ZERO_ADDRESS) == false", async () => {
			expect(await testLibraries.RSKAddrValidator_safeEquals(constants.ZERO_ADDRESS, constants.ZERO_ADDRESS)).to.be.false;
		});
		it("safeEquals(account1, ZERO_ADDRESS) == false", async () => {
			expect(await testLibraries.RSKAddrValidator_safeEquals(constants.ZERO_ADDRESS, account1)).to.be.false;
			expect(await testLibraries.RSKAddrValidator_safeEquals(account1, constants.ZERO_ADDRESS)).to.be.false;
		});
		it("safeEquals(account1, account2 || account2, account1) == false", async () => {
			expect(await testLibraries.RSKAddrValidator_safeEquals(account2, account1)).to.be.false;
			expect(await testLibraries.RSKAddrValidator_safeEquals(account1, account2)).to.be.false;
		});
	});
});
