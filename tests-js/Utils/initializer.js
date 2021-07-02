const { BN } = require("@openzeppelin/test-helpers");
const constants = require("@openzeppelin/test-helpers/src/constants");
const { expect } = require("chai");

const TestToken = artifacts.require("TestToken");
const TestWrbtc = artifacts.require("TestWrbtc");

const PriceFeedsLocal = artifacts.require("PriceFeedsLocal");
const ProtocolSettings = artifacts.require("ProtocolSettings");
const sovrynProtocol = artifacts.require("sovrynProtocol");
const ISovryn = artifacts.require("ISovryn");

const LoanSettings = artifacts.require("LoanSettings");
const LoanMaintenance = artifacts.require("LoanMaintenance");
const LoanOpenings = artifacts.require("LoanOpenings");
const LoanClosingsWith = artifacts.require("LoanClosingsWith");
const LoanClosingsBase = artifacts.require("LoanClosingsBase");

const SwapsExternal = artifacts.require("SwapsExternal");

const LoanToken = artifacts.require("LoanToken");
const LoanTokenLogicStandard = artifacts.require("LoanTokenLogicTest");
const LoanTokenLogicWrbtc = artifacts.require("LoanTokenLogicWrbtc");

const TestSovrynSwap = artifacts.require("TestSovrynSwap");
const SwapsImplSovrynSwap = artifacts.require("SwapsImplSovrynSwap");

const Affiliates = artifacts.require("Affiliates");

const wei = web3.utils.toWei;
const oneEth = new BN(wei("1", "ether"));
const hunEth = new BN(wei("100", "ether"));
const tenKEth = new BN(wei("10", "kether"));
const totalSupply = new BN(10).pow(new BN(50)).toString();

const CONSTANTS = {
	ZERO_ADDRESS: "0x0000000000000000000000000000000000000000",
	ONE_ADDRESS: "0x0000000000000000000000000000000000000001",
	MAX_UINT: "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
};

const getSUSD = async () => {
	const susd = await TestToken.new("SUSD", "SUSD", 18, totalSupply);
	return susd;
};

const getRBTC = async () => {
	const rbtc = await TestToken.new("RBTC", "RBTC", 18, totalSupply);
	return rbtc;
};

const getWRBTC = async () => {
	const wrbtc = await TestWrbtc.new();
	return wrbtc;
};

const getBZRX = async () => {
	const bzrx = await TestWrbtc.new();
	return bzrx;
};

const getSOV = async (sovryn, priceFeeds, SUSD) => {
	const sov = await TestToken.new("SOV", "SOV", 18, totalSupply);
	await sovryn.setProtocolTokenAddress(sov.address);

	await priceFeeds.setRates(SUSD.address, sov.address, oneEth);

	await sov.approve(sovryn.address, new BN(10).pow(new BN(20)));
	await sovryn.depositProtocolToken(new BN(10).pow(new BN(20)));

	return sov;
};

const getPriceFeeds = async (WRBTC, SUSD, RBTC, sovryn, BZRX) => {
	const feeds = await PriceFeedsLocal.new(WRBTC.address, BZRX.address);

	await feeds.setRates(WRBTC.address, RBTC.address, oneEth.toString());
	await feeds.setRates(WRBTC.address, SUSD.address, new BN(10).pow(new BN(22)).toString());
	await feeds.setRates(RBTC.address, SUSD.address, new BN(10).pow(new BN(22)).toString());
	return feeds;
};

const getPriceFeedsRBTC = async (WRBTC, SUSD, RBTC, sovryn, BZRX) => {
	const feeds = await PriceFeedsLocal.new(WRBTC.address, BZRX.address);

	await feeds.setRates(WRBTC.address, RBTC.address, oneEth.toString());
	await feeds.setRates(WRBTC.address, SUSD.address, oneEth.toString());
	await feeds.setRates(RBTC.address, SUSD.address, new BN(10).pow(new BN(22)).toString());
	return feeds;
};

const getSovryn = async (WRBTC, SUSD, RBTC, priceFeeds) => {
	const sovrynproxy = await sovrynProtocol.new();
	const sovryn = await ISovryn.at(sovrynproxy.address);

	await sovryn.replaceContract((await ProtocolSettings.new()).address);
	await sovryn.replaceContract((await LoanSettings.new()).address);
	await sovryn.replaceContract((await LoanMaintenance.new()).address);
	await sovryn.replaceContract((await SwapsExternal.new()).address);

	const sovrynSwapSimulator = await TestSovrynSwap.new(priceFeeds.address);
	await sovryn.setSovrynSwapContractRegistryAddress(sovrynSwapSimulator.address);
	await sovryn.setSupportedTokens([SUSD.address, RBTC.address, WRBTC.address], [true, true, true]);

	await sovryn.setWrbtcToken(WRBTC.address);

	// loanOpening
	const swaps = await SwapsImplSovrynSwap.new();
	await sovryn.replaceContract((await LoanOpenings.new()).address);
	await sovryn.setPriceFeedContract(priceFeeds.address);
	await sovryn.setSwapsImplContract(swaps.address);

	// loanClosing
	await sovryn.replaceContract((await LoanClosingsWith.new()).address);
	await sovryn.replaceContract((await LoanClosingsBase.new()).address);

	// affiliates
	await sovryn.replaceContract((await Affiliates.new()).address);

	return sovryn;
};

// Loan Token

const getLoanTokenLogic = async () => {
	const loanTokenLogicStandard = await LoanTokenLogicStandard.new();
	return loanTokenLogicStandard;
};
const getLoanTokenLogicWrbtc = async () => {
	const loanTokenLogicWrbtc = await LoanTokenLogicWrbtc.new();
	return loanTokenLogicWrbtc;
};

const getLoanTokenSettings = async () => {
	const loanSettings = await LoanSettings.new();
	return loanSettings;
};

const getLoanToken = async (loanTokenLogicStandard, owner, sovryn, WRBTC, SUSD) => {
	let loanToken = await LoanToken.new(owner, loanTokenLogicStandard.address, sovryn.address, WRBTC.address);
	await loanToken.initialize(SUSD.address, "SUSD", "SUSD"); //iToken
	loanToken = await LoanTokenLogicStandard.at(loanToken.address);
	// assert loanToken.tokenPrice() == loanToken.initialPrice()
	// const initial_total_supply = await loanToken.totalSupply();
	// loan token total supply should be zero
	// assert initial_total_supply == loanToken.totalSupply()
	return loanToken;
};

const getLoanTokenWRBTC = async (loanTokenLogicWrbtc, owner, sovryn, WRBTC, SUSD) => {
	let loanTokenWRBTC = await LoanToken.new(owner, loanTokenLogicWrbtc.address, sovryn.address, WRBTC.address);
	await loanTokenWRBTC.initialize(WRBTC.address, "iWRBTC", "iWRBTC"); //iToken
	loanTokenWRBTC = await LoanTokenLogicWrbtc.at(loanTokenWRBTC.address);
	// assert loanToken.tokenPrice() == loanToken.initialPrice()
	// const initial_total_supply = await loanToken.totalSupply();
	// loan token total supply should be zero
	// assert initial_total_supply == loanToken.totalSupply()
	return loanTokenWRBTC;
};

const loan_pool_setup = async (sovryn, owner, RBTC, WRBTC, SUSD, loanToken, loanTokenWRBTC) => {
	let params = [];
	let config = [
		"0x0000000000000000000000000000000000000000000000000000000000000000", // bytes32 id; // id of loan params object
		false, // bool active; // if false, this object has been disabled by the owner and can't be used for future loans
		owner, // address owner; // owner of this object
		CONSTANTS.ZERO_ADDRESS, // address loanToken; // the token being loaned
		RBTC.address, // address collateralToken; // the required collateral token
		wei("20", "ether"), // uint256 minInitialMargin; // the minimum allowed initial margin
		wei("15", "ether"), // uint256 maintenanceMargin; // an unhealthy loan when current margin is at or below this value
		0, // uint256 maxLoanTerm; // the maximum term for new loans (0 means there's no max term)
	];
	params.push(config);
	const copy1 = [...config];
	copy1[4] = WRBTC.address;
	params.push(copy1);

	await loanToken.setupLoanParams(params, false);
	await loanToken.setupLoanParams(params, true);

	params = [];
	const copy2 = [...config];
	copy2[4] = SUSD.address;
	params.push(copy2);

	await loanTokenWRBTC.setupLoanParams(params, false);
	await loanTokenWRBTC.setupLoanParams(params, true);

	await sovryn.setLoanPool([loanToken.address, loanTokenWRBTC.address], [SUSD.address, WRBTC.address]);
};

const set_demand_curve = async (loanToken) => {
	const baseRate = wei("1", "ether");
	const rateMultiplier = wei("20.25", "ether");
	const targetLevel = wei("80", "ether");
	const kinkLevel = wei("90", "ether");
	const maxScaleRate = wei("100", "ether");

	const localLoanToken = await LoanTokenLogicStandard.at(loanToken.address);
	await localLoanToken.setDemandCurve(baseRate, rateMultiplier, baseRate, rateMultiplier, targetLevel, kinkLevel, maxScaleRate);
	// borrow_interest_rate = loanToken.borrowInterestRate();
	// print("borrowInterestRate: ", borrow_interest_rate);
	// assert(borrow_interest_rate > baseRate);
};

const lend_to_pool = async (loanToken, SUSD, lender) => {
	const lend_amount = new BN(10).pow(new BN(30)).toString();
	await SUSD.mint(lender, lend_amount);
	await SUSD.approve(loanToken.address, lend_amount);
	await loanToken.mint(lender, lend_amount);
	return [lender, lend_amount];
};

const lend_to_pool_iBTC = async (loanTokenWRBTC, lender) => {
	const lend_amount = new BN(10).pow(new BN(21)).toString();
	await loanTokenWRBTC.mintWithBTC(lender, false, { from: lender, value: lend_amount });
	return [lender, lend_amount];
};

const open_margin_trade_position = async (
	loanToken,
	RBTC,
	WRBTC,
	SUSD,
	trader,
	collateral = "RBTC",
	loan_token_sent = hunEth.toString(),
	leverage_amount = new BN(2).mul(oneEth).toString()
) => {
	await SUSD.mint(trader, loan_token_sent);
	await SUSD.approve(loanToken.address, loan_token_sent, { from: trader });

	let collateralToken;
	if (collateral == "RBTC") collateralToken = RBTC.address;
	else collateralToken = WRBTC.address;

	const { receipt } = await loanToken.marginTrade(
		"0x0", // loanId  (0 for new loans)
		leverage_amount, // leverageAmount
		loan_token_sent, // loanTokenSent
		0, // no collateral token sent
		collateralToken, // collateralTokenAddress
		trader, // trader,
		0,
		[], // loanDataBytes (only required with ether)
		{ from: trader }
	);
	const decode = decodeLogs(receipt.rawLogs, LoanOpenings, "Trade");
	return [decode[0].args["loanId"], trader, loan_token_sent, leverage_amount];
};

const open_margin_trade_position_iBTC = async (
	loanTokenWRBTC,
	SUSD,
	trader,
	loan_token_sent = oneEth.toString(),
	leverage_amount = new BN(2).mul(oneEth).toString()
) => {
	const { receipt } = await loanTokenWRBTC.marginTrade(
		"0x0", // loanId  (0 for new loans)
		leverage_amount, // leverageAmount
		loan_token_sent, // loanTokenSent
		0, // no collateral token sent
		SUSD.address, // collateralTokenAddress
		trader, // trader,
		0,
		[], // loanDataBytes (only required with ether)
		{ from: trader, value: loan_token_sent }
	);

	const decode = decodeLogs(receipt.rawLogs, LoanOpenings, "Trade");
	return [decode[0].args["loanId"], trader, loan_token_sent, leverage_amount];
};

const borrow_indefinite_loan = async (
	loanToken,
	sovryn,
	SUSD,
	RBTC,
	accounts,
	withdraw_amount = new BN(10).mul(oneEth).toString(),
	margin = new BN(50).mul(oneEth).toString(),
	duration_in_seconds = 60 * 60 * 24 * 10
) => {
	const borrower = accounts[2];
	const receiver = accounts[1];
	const collateral_token_sent = await sovryn.getRequiredCollateral(SUSD.address, RBTC.address, withdraw_amount, margin, true);
	// approve the transfer of the collateral
	await RBTC.mint(borrower, collateral_token_sent);
	await RBTC.approve(loanToken.address, collateral_token_sent, { from: borrower });
	// borrow some funds
	const tx = await loanToken.borrow(
		constants.ZERO_BYTES32, // bytes32 loanId
		withdraw_amount, // uint256 withdrawAmount
		duration_in_seconds, // uint256 initialLoanDuration
		collateral_token_sent, // uint256 collateralTokenSent
		RBTC.address, // address collateralTokenAddress
		borrower, // address borrower
		receiver, // address receiver
		"0x", // bytes memory loanDataBytes
		{ from: borrower }
	);
	const decode = decodeLogs(tx.receipt.rawLogs, LoanOpenings, "Borrow");
	const loan_id = decode[0].args["loanId"];
	return [loan_id, borrower, receiver, withdraw_amount, duration_in_seconds, margin, decode[0].args];
};

function decodeLogs(logs, emitter, eventName) {
	let abi;
	let address;
	abi = emitter.abi;
	try {
		address = emitter.address;
	} catch (e) {
		address = null;
	}

	let eventABI = abi.filter((x) => x.type === "event" && x.name === eventName);
	if (eventABI.length === 0) {
		throw new Error(`No ABI entry for event '${eventName}'`);
	} else if (eventABI.length > 1) {
		throw new Error(`Multiple ABI entries for event '${eventName}', only uniquely named events are supported`);
	}

	eventABI = eventABI[0];

	// The first topic will equal the hash of the event signature
	const eventSignature = `${eventName}(${eventABI.inputs.map((input) => input.type).join(",")})`;
	const eventTopic = web3.utils.sha3(eventSignature);

	// Only decode events of type 'EventName'
	return logs
		.filter((log) => log.topics.length > 0 && log.topics[0] === eventTopic && (!address || log.address === address))
		.map((log) => web3.eth.abi.decodeLog(eventABI.inputs, log.data, log.topics.slice(1)))
		.map((decoded) => ({ event: eventName, args: decoded }));
}

const verify_sov_reward_payment = async (logs, FeesEvents, SOV, borrower, loan_id, sov_initial_balance, expected_events_number) => {
	const earn_reward_events = decodeLogs(logs, FeesEvents, "EarnReward");
	const len = earn_reward_events.length;
	expect(len).to.equal(expected_events_number);

	let reward = new BN(0);
	for (let i = 0; i < len; i++) {
		const args = earn_reward_events[i].args;
		expect(args["receiver"]).to.equal(borrower);
		expect(args["token"]).to.equal(SOV.address);
		expect(args["loanId"]).to.equal(loan_id);
		reward = reward.add(new BN(args["amount"]));
	}

	expect(await SOV.balanceOf(borrower)).to.be.a.bignumber.equal(sov_initial_balance.add(reward));
};

module.exports = {
	getSUSD,
	getRBTC,
	getWRBTC,
	getBZRX,
	getSOV,
	getLoanTokenLogic,
	getLoanTokenLogicWrbtc,
	getLoanToken,
	getLoanTokenWRBTC,
	loan_pool_setup,
	lend_to_pool,
	set_demand_curve,
	getPriceFeeds,
	getPriceFeedsRBTC,
	getSovryn,
	CONSTANTS,
	decodeLogs,
	verify_sov_reward_payment,
	lend_to_pool_iBTC,
	open_margin_trade_position,
	open_margin_trade_position_iBTC,
	borrow_indefinite_loan,
};
