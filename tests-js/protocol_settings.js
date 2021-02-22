const { assert } = require("chai");

const { BN, constants, balance, expectEvent, expectRevert } = require("@openzeppelin/test-helpers");

const sovrynProtocol = artifacts.require("sovrynProtocol");
const ProtocolSettings = artifacts.require("ProtocolSettings");
const ISovryn = artifacts.require("ISovryn");

describe("Affliates", async (accounts) => {
	before(async () => {
		const sovrynproxy = await sovrynProtocol.new();
		sovryn = await ISovryn.at(sovrynproxy.address);
		await sovryn.replaceContract((await ProtocolSettings.new()).address);
		await sovryn.setSovrynProtocolAddress(sovrynproxy.address);
	});
	it("Saves Sovryn Proxy Address correctly", async function () {
		assert.equal(await sovryn.protocolAddress(), sovryn.address);
		//assert.equal(loanTokenAddress, doc.address, "Doc address not set yet");
	});
});
