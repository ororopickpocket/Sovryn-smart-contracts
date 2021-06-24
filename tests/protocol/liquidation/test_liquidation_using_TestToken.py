'''
Should test the liquidation handling
1. Liquidate a position
2. Should fail to liquidate a healthy position
'''

import pytest
from brownie import Contract, Wei, reverts
from fixedint import *
import shared
from protocol.liquidation.shared_liquidation_functions import *

'''
Test with different rates so the currentMargin is <= liquidationIncentivePercent
or > liquidationIncentivePercent
liquidationIncentivePercent = 5e18 by default
'''
@pytest.mark.parametrize('rate', [1e21, 6.7e21])
def test_liquidate(accounts, loanToken, SUSD, set_demand_curve, RBTC, sovryn, priceFeeds, rate, WRBTC, FeesEvents, SOV, chain):
    liquidate(accounts, loanToken, SUSD, set_demand_curve, RBTC, sovryn, priceFeeds, rate, WRBTC, FeesEvents, SOV, chain, True)
    
'''
Test if fails when the position is healthy currentMargin > maintenanceRate
'''  
def test_liquidate_healthy_position_should_fail(accounts, loanToken, SUSD, set_demand_curve, RBTC, WRBTC, sovryn, priceFeeds):
    liquidate_healthy_position_should_fail(accounts, loanToken, SUSD, set_demand_curve, RBTC, sovryn, priceFeeds, WRBTC, False)