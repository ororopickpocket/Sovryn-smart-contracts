const { BN, expectRevert } = require("@openzeppelin/test-helpers");
const { expect } = require("chai");
const { decodeLogs, verify_sov_reward_payment } = require("../Utils/initializer");
const { increaseTime } = require("../Utils/Ethereum");
const LoanOpenings = artifacts.require("LoanOpenings");
const LoanClosingsEvents = artifacts.require("LoanClosingsEvents");
const LockedSOVMockup = artifacts.require("LockedSOVMockup");

const wei = web3.utils.toWei;
const oneEth = new BN(wei("1", "ether"));
const hunEth = new BN(wei("100", "ether"));

const liquidate = async (
	accounts,
	loanToken,
	underlyingToken,
	set_demand_curve,
	collateralToken,
	sovryn,
	priceFeeds,
	rate,
	WRBTC,
	FeesEvents,
	SOV,
	isSpecialRebates = false
) => {
	if (isSpecialRebates) {
		await sovryn.setSpecialRebates(underlyingToken.address, collateralToken.address, wei("70", "ether"));
	}
	// set the demand curve to set interest rates
	await set_demand_curve(loanToken);
	const lender = accounts[0];
	const borrower = accounts[1];
	const liquidator = accounts[2];
	const loan_token_sent = new BN(10).mul(oneEth);
	// lend to the pool, mint tokens if required, open a margin trade position
	const loan_id = await prepare_liquidation(
		lender,
		borrower,
		liquidator,
		loan_token_sent,
		loanToken,
		underlyingToken,
		collateralToken,
		sovryn,
		WRBTC
	);
	const loan = await sovryn.getLoan(loan_id);
	// set the rates so we're able to liquidate
	let value;
	if (underlyingToken.address == WRBTC.address) {
		await priceFeeds.setRates(underlyingToken.address, collateralToken.address, rate);
		value = loan_token_sent;
	} else {
		await priceFeeds.setRates(collateralToken.address, underlyingToken.address, rate);
		value = 0;
	}

	lockedSOV = await LockedSOVMockup.at(await sovryn.lockedSOVAddress());
	const sov_borrower_initial_balance = (await SOV.balanceOf(borrower)).add(await lockedSOV.getLockedBalance(borrower));
	await increaseTime(10 * 24 * 60 * 60); // time travel 10 days
	// liquidate
	const { receipt } = await sovryn.liquidate(loan_id, liquidator, loan_token_sent, { from: liquidator, value: value });
	await verify_liquidation_event(
		loan,
		receipt.rawLogs,
		lender,
		borrower,
		liquidator,
		loan_token_sent,
		loanToken,
		underlyingToken,
		collateralToken,
		sovryn,
		priceFeeds
	);
	if (underlyingToken.address != WRBTC.address)
		await verify_sov_reward_payment(
			receipt.rawLogs,
			FeesEvents,
			SOV,
			borrower,
			loan_id,
			sov_borrower_initial_balance,
			1,
			underlyingToken.address,
			collateralToken.address,
			sovryn
		);
};

/*
should fail to liquidate a healthy position
*/
const liquidate_healthy_position_should_fail = async (
	accounts,
	loanToken,
	underlyingToken,
	set_demand_curve,
	collateralToken,
	sovryn,
	priceFeeds,
	WRBTC
) => {
	// set the demand curve to set interest rates
	set_demand_curve(loanToken);
	const lender = accounts[0];
	const borrower = accounts[1];
	const liquidator = accounts[2];
	const loan_token_sent = new BN(10).mul(oneEth);
	// lend to the pool, mint tokens if required, open a margin trade position
	const loan_id = await prepare_liquidation(
		lender,
		borrower,
		liquidator,
		loan_token_sent,
		loanToken,
		underlyingToken,
		collateralToken,
		sovryn,
		WRBTC
	);
	// try to liquidate the still healthy position

	await expectRevert(sovryn.liquidate(loan_id, lender, loan_token_sent), "healthy position");
};

// lend to the pool, mint tokens if required, open a margin trade position
const prepare_liquidation = async (
	lender,
	borrower,
	liquidator,
	loan_token_sent,
	loanToken,
	underlyingToken,
	collateralToken,
	sovryn,
	WRBTC
) => {
	await underlyingToken.approve(loanToken.address, new BN(10).pow(new BN(40)));
	let value;
	if (WRBTC.address == underlyingToken.address) {
		await loanToken.mintWithBTC(lender, false, { value: new BN(10).pow(new BN(21)) });
		value = loan_token_sent;
	} else {
		await loanToken.mint(lender, new BN(10).pow(new BN(21)));
		await underlyingToken.mint(borrower, loan_token_sent);
		await underlyingToken.mint(liquidator, loan_token_sent);
		await underlyingToken.approve(loanToken.address, loan_token_sent, { from: borrower });
		await underlyingToken.approve(sovryn.address, loan_token_sent, { from: liquidator });
		value = 0;
	}
	const { receipt } = await loanToken.marginTrade(
		"0x0", // loanId  (0 for new loans)
		new BN(2).mul(oneEth), // leverageAmount
		loan_token_sent, // loanTokenSent
		0, // no collateral token sent
		collateralToken.address, // collateralTokenAddress
		borrower, // trader,
		"0x", // loanDataBytes (only required with ether)
		{ from: borrower, value: value }
	);
	const decode = decodeLogs(receipt.rawLogs, LoanOpenings, "Trade");
	return decode[0].args["loanId"];
};

//compute the expected values and make sure the event contains them
const verify_liquidation_event = async (
	loan,
	logs,
	lender,
	borrower,
	liquidator,
	loan_token_sent,
	loanToken,
	underlyingToken,
	collateralToken,
	sovryn,
	priceFeeds
) => {
	const loan_id = loan["loanId"];
	const collateral_ = new BN(loan["collateral"]);
	const principal_ = new BN(loan["principal"]);
	const res = await priceFeeds.getCurrentMargin(underlyingToken.address, collateralToken.address, principal_, collateral_);
	const current_margin = res.currentMargin;
	const collateral_to_loan_rate = res.collateralToLoanRate;
	const liquidation_incentive_percent = new BN(await sovryn.liquidationIncentivePercent());
	const maintenance_margin = new BN(loan["maintenanceMargin"]);
	const desired_margin = maintenance_margin.add(new BN(5).mul(oneEth));

	let max_liquidatable = desired_margin.add(hunEth).mul(principal_).div(hunEth);
	max_liquidatable = max_liquidatable.sub(collateral_.mul(collateral_to_loan_rate).div(oneEth));
	max_liquidatable = max_liquidatable.mul(hunEth).div(desired_margin.sub(liquidation_incentive_percent));
	max_liquidatable = max_liquidatable.gt(principal_) ? principal_ : max_liquidatable;

	let max_seizable = max_liquidatable.mul(liquidation_incentive_percent.add(hunEth));
	max_seizable = max_seizable.div(collateral_to_loan_rate).div(new BN(100));
	max_seizable = max_seizable.gt(collateral_) ? collateral_ : max_seizable;
	const loan_close_amount = loan_token_sent.gt(max_liquidatable) ? max_liquidatable : loan_token_sent;
	const collateral_withdraw_amount = max_seizable.mul(loan_close_amount).div(max_liquidatable);

	const decode = decodeLogs(logs, LoanClosingsEvents, "Liquidate");
	const liquidate_event = decode[0].args;

	expect(liquidate_event["user"] == borrower).to.be.true;
	expect(liquidate_event["liquidator"] == liquidator).to.be.true;
	expect(liquidate_event["loanId"] == loan_id).to.be.true;
	expect(liquidate_event["lender"] == loanToken.address).to.be.true;
	expect(liquidate_event["loanToken"] == underlyingToken.address).to.be.true;
	expect(liquidate_event["collateralToken"] == collateralToken.address).to.be.true;
	expect(liquidate_event["repayAmount"] == loan_token_sent.toString()).to.be.true;
	expect(liquidate_event["collateralWithdrawAmount"] == collateral_withdraw_amount.toString()).to.be.true;
	expect(liquidate_event["collateralToLoanRate"] == collateral_to_loan_rate.toString()).to.be.true;
	expect(liquidate_event["currentMargin"] == current_margin.toString()).to.be.true;
};

module.exports = {
	liquidate,
	liquidate_healthy_position_should_fail,
};
